import type {
  WorkflowArtifactRevision,
  WorkflowDecision,
  WorkflowDecisionRecord,
  WorkflowReviewAggregate,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowDecisionV1 } from '../../../shared/workflow-result-schema'
import {
  workflowReviewExtensionForBudget,
  workflowReviewRoundLimit
} from '../../../shared/workflow-review-round-budget'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import {
  applyWorkflowDecision,
  currentWorkflowAggregate,
  persistWorkflowDecision,
  requiredWorkflowTransition,
  workflowAssignmentsForNode,
  workflowDecisionBindings,
  workflowResolutionContext,
  WORKFLOW_DECISION_RULE_VERSION
} from './workflow-transition-application'

export { WORKFLOW_DECISION_RULE_VERSION } from './workflow-transition-application'

export function advanceProduceTransition(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  artifact: WorkflowArtifactRevision
): WorkflowStepRunRecord[] {
  const transition = requiredWorkflowTransition(run, step.nodeId, 'step:succeeded')
  const review = run.templateSnapshot.nodes.find(
    (node) => node.id === transition.to && node.type === 'review'
  )
  if (review?.type !== 'review') {
    throw new WorkflowError(
      'workflow_transition_invalid',
      `Produce transition ${transition.id} must target a Review node.`
    )
  }
  const assignments = workflowAssignmentsForNode(run, review.id)
  if (assignments.length < review.reviewPolicy.minReviewers) {
    throw new WorkflowError('workflow_context_mismatch', 'Review node assignment is missing.')
  }
  const round = step.round
  const reviewSteps = assignments.map((assignment) =>
    store.insertStep(run.id, review, assignment, artifact.id, 'queued', round)
  )
  const rounds = { ...run.reviewRoundsByNodeId, [review.id]: round }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET current_node_id = ?, review_rounds_json = ?, version = version + 1,
           updated_at = datetime('now') WHERE id = ? AND version = ?`
    )
    .run(review.id, JSON.stringify(rounds), run.id, run.version)
  store.insertEvent(run.id, 'review-fan-out', null, {
    reviewNodeId: review.id,
    round,
    artifactRevisionId: artifact.id,
    reviewerStepRunIds: reviewSteps.map((candidate) => candidate.id),
    deliveryIds: reviewSteps.map((candidate) => candidate.deliveryId)
  })
  return reviewSteps
}

export function advanceReviewAggregate(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate
): WorkflowStepRunRecord | null {
  const bindings = workflowDecisionBindings(run, aggregate)
  const deterministicDecision = decideReviewAggregate(run, aggregate)
  const deciderAssignment = workflowAssignmentsForNode(run, bindings.decision.id)[0]
  if (bindings.decision.mode === 'rules-then-agent' && deciderAssignment) {
    const step = store.insertStep(
      run.id,
      bindings.decision,
      deciderAssignment,
      aggregate.artifactRevisionId,
      'queued',
      aggregate.round
    )
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET current_node_id = ?, version = version + 1, updated_at = datetime('now')
         WHERE id = ? AND version = ?`
      )
      .run(bindings.decision.id, run.id, run.version)
    store.insertEvent(run.id, 'decision-made', step.id, {
      phase: 'deterministic-preview',
      ruleVersion: WORKFLOW_DECISION_RULE_VERSION,
      deterministicDecision,
      aggregateId: aggregate.id
    })
    return step
  }
  const step = store.insertStep(
    run.id,
    bindings.decision,
    null,
    aggregate.artifactRevisionId,
    'queued',
    aggregate.round
  )
  store.finishEngineStep(
    step.id,
    {
      schema: 'workflow.decision/v1',
      reviewAggregateId: aggregate.id,
      decision: deterministicDecision,
      ruleVersion: WORKFLOW_DECISION_RULE_VERSION
    },
    `Deterministic decision: ${deterministicDecision}`
  )
  persistWorkflowDecision(store, {
    run,
    step,
    aggregate,
    deterministicDecision,
    finalDecision: deterministicDecision,
    source: 'rules'
  })
  applyWorkflowDecision(store, run, step, aggregate, deterministicDecision)
  return null
}

export function finishAgentDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  aggregate: WorkflowReviewAggregate,
  collected: {
    result: WorkflowDecisionV1
    source: WorkflowStepRunRecord['messageSource'] & string
    digest: string
    sourceIdentity: string | null
    sourceReference: unknown
    warnings: string[]
  },
  apply = true
): void {
  const deterministicDecision = decideReviewAggregate(run, aggregate)
  const finalDecision =
    deterministicDecision === 'stop-at-review' ? 'stop-at-review' : collected.result.decision
  store.finishStep({
    stepRunId: step.id,
    envelope: collected.result,
    conclusionMarkdown: collected.result.conclusionMarkdown,
    source: collected.source,
    digest: collected.digest,
    sourceIdentity: collected.sourceIdentity,
    warnings: collected.warnings
  })
  persistWorkflowDecision(store, {
    run,
    step,
    aggregate,
    deterministicDecision,
    finalDecision,
    source: 'agent'
  })
  if (apply) {
    applyWorkflowDecision(store, run, step, aggregate, finalDecision)
  }
}

export function applyPersistedDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  decision: WorkflowDecisionRecord
): void {
  const step = store.getStep(decision.stepRunId)
  const aggregate = store
    .listReviewAggregates(run.id)
    .find((candidate) => candidate.id === decision.reviewAggregateId)
  if (!step || !aggregate) {
    throw new WorkflowError(
      'workflow_transition_invalid',
      'Pending Decision evidence is unavailable.'
    )
  }
  applyWorkflowDecision(store, run, step, aggregate, decision.finalDecision)
}

export function decideReviewAggregate(
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate
): WorkflowDecision {
  if (aggregate.outcome === 'request-human' || aggregate.conflicts.length > 0) {
    return 'request-human'
  }
  if (aggregate.outcome === 'approve') {
    return 'approve'
  }
  const limit = workflowReviewRoundLimit(run, aggregate.reviewNodeId)
  if (limit === null) {
    throw new WorkflowError('workflow_transition_invalid', 'Review node is unavailable.')
  }
  return aggregate.round >= limit ? 'stop-at-review' : 'revise'
}

export function resolutionContextForAggregate(
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate,
  originDecisionStepId: string
) {
  return workflowResolutionContext(run, aggregate, originDecisionStepId)
}

export function applyHumanReviewDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  action: 'approve' | 'revise' | 'continue-round',
  actorIdentity: string,
  options: { instructions?: string; reviewRoundBudget?: number } = {}
): void {
  const aggregate = currentWorkflowAggregate(run)
  const context = run.resolutionContext!
  const step = store.getStep(context.originDecisionStepId)
  if (!step) {
    throw new WorkflowError('workflow_transition_invalid', 'Origin Decision Step is unavailable.')
  }
  if (action === 'continue-round') {
    const extensions = {
      ...run.reviewRoundExtensionsByNodeId,
      [context.reviewNodeId]: (run.reviewRoundExtensionsByNodeId[context.reviewNodeId] ?? 0) + 1
    }
    store.db
      .prepare('UPDATE workflow_runs SET review_round_extensions_json = ? WHERE id = ?')
      .run(JSON.stringify(extensions), run.id)
    run = { ...run, reviewRoundExtensionsByNodeId: extensions }
  } else if (action === 'revise') {
    const review = run.templateSnapshot.nodes.find(
      (node) => node.id === context.reviewNodeId && node.type === 'review'
    )
    if (review?.type !== 'review') {
      throw new WorkflowError('workflow_transition_invalid', 'Review node is unavailable.')
    }
    const budget = options.reviewRoundBudget ?? review.reviewPolicy.maxReviewRounds
    const extensions = {
      ...run.reviewRoundExtensionsByNodeId,
      [context.reviewNodeId]: workflowReviewExtensionForBudget(
        run,
        context.reviewNodeId,
        aggregate.round,
        budget
      )
    }
    store.db
      .prepare('UPDATE workflow_runs SET review_round_extensions_json = ? WHERE id = ?')
      .run(JSON.stringify(extensions), run.id)
    run = { ...run, reviewRoundExtensionsByNodeId: extensions }
  }
  const finalDecision = action === 'approve' ? 'approve' : 'revise'
  persistWorkflowDecision(store, {
    run,
    step,
    aggregate,
    deterministicDecision: decideReviewAggregate(run, aggregate),
    finalDecision,
    source: 'human',
    actorIdentity,
    humanInstructions: options.instructions,
    reviewRoundBudget: action === 'revise' ? options.reviewRoundBudget : undefined
  })
  applyWorkflowDecision(store, run, step, aggregate, finalDecision)
}
