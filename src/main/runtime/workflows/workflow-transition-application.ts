import type {
  WorkflowAgentAssignment,
  WorkflowDecision,
  WorkflowDecisionRecord,
  WorkflowReviewAggregate,
  WorkflowRunRecord,
  WorkflowStepRunRecord,
  WorkflowTransitionV1,
  WorkflowNodeDefinitionV1
} from '../../../shared/workflow-definition-types'
import { requireWorkflowDefinitionV1 } from '../../../shared/workflow-definition-access'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { workflowRecordId } from './workflow-runtime-records'

export const WORKFLOW_DECISION_RULE_VERSION = 'workflow-decision-rules/v1'

export function applyWorkflowDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  aggregate: WorkflowReviewAggregate,
  decision: WorkflowDecision
): void {
  const bindings = workflowDecisionBindings(run, aggregate)
  const context = workflowResolutionContext(run, aggregate, step.id)
  store.insertEvent(run.id, 'decision-made', step.id, {
    aggregateId: aggregate.id,
    decision,
    ruleVersion: WORKFLOW_DECISION_RULE_VERSION
  })
  if (decision === 'approve') {
    applyTransition(store, run, bindings.approve, aggregate, context, false)
    return
  }
  if (decision === 'revise') {
    applyTransition(store, run, bindings.revise, aggregate, context, true)
    return
  }
  const waitingReason =
    decision === 'stop-at-review'
      ? 'review-limit-reached'
      : (aggregate.waitingReason ?? 'review-request-human')
  const status = decision === 'stop-at-review' ? 'review-limit-reached' : 'waiting-human'
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = ?, current_node_id = ?, waiting_reason = ?,
           resolution_context_json = ?, failure_code = NULL, failure_message = NULL,
           recovery = NULL, completed_at = NULL, version = version + 1,
           updated_at = datetime('now') WHERE id = ?`
    )
    .run(status, bindings.decision.id, waitingReason, JSON.stringify(context), run.id)
  store.insertEvent(
    run.id,
    decision === 'stop-at-review' ? 'review-limit-reached' : 'review-waiting',
    step.id,
    { aggregateId: aggregate.id, waitingReason, resolutionContext: context }
  )
}

export function persistWorkflowDecision(
  store: WorkflowRuntimePersistence,
  params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    aggregate: WorkflowReviewAggregate
    deterministicDecision: WorkflowDecision
    finalDecision: WorkflowDecision
    source: WorkflowDecisionRecord['source']
    actorIdentity?: string
    humanInstructions?: string
    reviewRoundBudget?: number
  }
): void {
  store.db
    .prepare(
      `INSERT INTO workflow_decisions (
         id, run_id, step_run_id, review_aggregate_id, rule_version,
         deterministic_decision, final_decision, source, input_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workflowRecordId('workflow_decision'),
      params.run.id,
      params.step.id,
      params.aggregate.id,
      WORKFLOW_DECISION_RULE_VERSION,
      params.deterministicDecision,
      params.finalDecision,
      params.source,
      JSON.stringify({
        aggregate: params.aggregate,
        actorIdentity: params.actorIdentity ?? null,
        humanInstructions: params.humanInstructions?.trim() || null,
        reviewRoundBudget: params.reviewRoundBudget ?? null
      })
    )
}

export function workflowResolutionContext(
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate,
  originDecisionStepId: string
) {
  const bindings = workflowDecisionBindings(run, aggregate)
  return {
    originDecisionStepId,
    originDecisionNodeId: bindings.decision.id,
    reviewNodeId: aggregate.reviewNodeId,
    artifactRevisionId: aggregate.artifactRevisionId,
    approveTransitionId: bindings.approve.id,
    reviseTransitionId: bindings.revise.id
  }
}

export function workflowDecisionBindings(
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate
) {
  const reviewTransition = requiredWorkflowTransition(run, aggregate.reviewNodeId, 'step:succeeded')
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 decision binding')
  const decision = definition.nodes.find(
    (node) => node.id === reviewTransition.to && node.type === 'decide'
  )
  if (decision?.type !== 'decide') {
    throw new WorkflowError('workflow_transition_invalid', 'Review Decision node is unavailable.')
  }
  return {
    decision,
    approve: requiredWorkflowTransition(run, decision.id, 'decision:approve'),
    revise: requiredWorkflowTransition(run, decision.id, 'decision:revise')
  }
}

export function requiredWorkflowTransition(
  run: WorkflowRunRecord,
  from: string,
  when: WorkflowTransitionV1['when']
): WorkflowTransitionV1 {
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 transition lookup')
  const transition = definition.transitions.find(
    (candidate) => candidate.from === from && candidate.when === when
  )
  if (!transition) {
    throw new WorkflowError(
      'workflow_transition_invalid',
      `Transition ${from} / ${when} is unavailable.`
    )
  }
  return transition
}

export function currentWorkflowAggregate(run: WorkflowRunRecord): WorkflowReviewAggregate {
  const context = run.resolutionContext
  const aggregate = run.reviewAggregates
    .toReversed()
    .find(
      (candidate) =>
        candidate.reviewNodeId === context?.reviewNodeId &&
        candidate.artifactRevisionId === context.artifactRevisionId
    )
  if (!aggregate) {
    throw new WorkflowError('workflow_transition_invalid', 'Current Review Aggregate is missing.')
  }
  return aggregate
}

export function workflowAssignmentsForNode(
  run: WorkflowRunRecord,
  nodeId: string
): WorkflowAgentAssignment[] {
  return run.assignments.filter((assignment) => assignment.nodeId === nodeId)
}

function applyTransition(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  transition: WorkflowTransitionV1,
  aggregate: WorkflowReviewAggregate,
  context: object,
  revision: boolean
): void {
  if (transition.to === 'run:completed') {
    completeRun(store, run, null, context)
    return
  }
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 transition apply')
  const target = definition.nodes.find((node) => node.id === transition.to)
  if (target?.type === 'complete') {
    completeRun(store, run, target, context)
    return
  }
  if (target?.type !== 'produce') {
    throw new WorkflowError(
      'workflow_transition_invalid',
      `Transition ${transition.id} does not target a supported Produce or Complete node.`
    )
  }
  const assignment = workflowAssignmentsForNode(run, target.id)[0]
  if (!assignment) {
    enterAgentUnavailable(store, run, aggregate, context, target.id)
    return
  }
  const round = revision ? aggregate.round + 1 : 1
  const next = store.insertStep(
    run.id,
    target,
    assignment,
    aggregate.artifactRevisionId,
    'queued',
    round
  )
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'running', current_node_id = ?, waiting_reason = NULL,
           resolution_context_json = NULL, failure_code = NULL, failure_message = NULL,
           recovery = NULL, completed_at = NULL, version = version + 1,
           updated_at = datetime('now') WHERE id = ?`
    )
    .run(target.id, run.id)
  if (revision) {
    store.insertEvent(run.id, 'revision-requested', next.id, {
      aggregateId: aggregate.id,
      artifactRevisionId: aggregate.artifactRevisionId,
      transitionId: transition.id,
      nextRound: round
    })
  }
}

function completeRun(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  complete: WorkflowNodeDefinitionV1 | null,
  context: object
): void {
  if (complete?.type === 'complete') {
    const completeStep = store.insertStep(run.id, complete, null, null, 'succeeded')
    store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET started_at = datetime('now'), completed_at = datetime('now') WHERE id = ?`
      )
      .run(completeStep.id)
    store.insertEvent(run.id, 'step-completed', completeStep.id, { nodeId: complete.id })
  }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'completed', current_node_id = ?, waiting_reason = NULL,
           resolution_context_json = ?, completed_at = datetime('now'),
           version = version + 1, updated_at = datetime('now') WHERE id = ?`
    )
    .run(complete?.id ?? run.currentNodeId, JSON.stringify(context), run.id)
  store.insertEvent(run.id, 'run-completed', null, {})
}

function enterAgentUnavailable(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate,
  context: object,
  targetNodeId: string
): void {
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'waiting-human', current_node_id = ?,
           waiting_reason = 'agent-unavailable', resolution_context_json = ?,
           version = version + 1, updated_at = datetime('now') WHERE id = ?`
    )
    .run(targetNodeId, JSON.stringify(context), run.id)
  store.insertEvent(run.id, 'review-waiting', null, {
    aggregateId: aggregate.id,
    waitingReason: 'agent-unavailable'
  })
}
