import type {
  WorkflowAgentAssignment,
  WorkflowNodeDefinitionV1,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowDefinitionV2 } from '../../../shared/workflow-definition-v2-types'
import { workflowV2StepById, type WorkflowV2GraphAdvance } from '../../../shared/workflow-v2-graph'
import { WorkflowError } from './workflow-error'
import type { WorkflowV2RuntimeSurface } from './workflow-v2-run-controller'
import { hasWorkflowV2StepVisitedInCycle } from './workflow-v2-history-store'

export type WorkflowV2AdvanceResult = {
  nextSteps: WorkflowStepRunRecord[]
  terminal: boolean
  waitingHuman: boolean
}

export function applyWorkflowV2Advance(
  store: WorkflowV2RuntimeSurface,
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionV2,
  advance: WorkflowV2GraphAdvance,
  round: number
): WorkflowV2AdvanceResult {
  if (advance.kind === 'end') {
    const status =
      advance.outcome === 'succeeded'
        ? 'completed'
        : advance.outcome === 'cancelled'
          ? 'cancelled'
          : 'failed'
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = ?, current_node_id = NULL, completed_at = datetime('now'),
             version = version + 1, updated_at = datetime('now') WHERE id = ?`
      )
      .run(status, run.id)
    store.insertEvent(
      run.id,
      status === 'completed'
        ? 'run-completed'
        : status === 'cancelled'
          ? 'run-cancelled'
          : 'run-failed',
      null,
      { schemaVersion: 2, outcome: advance.outcome }
    )
    return { nextSteps: [], terminal: true, waitingHuman: false }
  }
  if (advance.kind === 'wait-human') {
    return parkWaitingHuman(store, run, advance.stepId, {
      exhaustedRouteId: advance.exhaustedRouteId,
      exhaustedTargetStepId: advance.exhaustedTargetStepId
    })
  }
  if (advance.kind === 'retry-decision') {
    return parkWaitingHuman(store, run, run.currentNodeId ?? definition.entryStepId)
  }
  const target = workflowV2StepById(definition, advance.stepId)
  if (target?.kind === 'end') {
    return applyWorkflowV2Advance(
      store,
      run,
      definition,
      { kind: 'end', outcome: target.outcome },
      round
    )
  }
  if (target?.kind === 'human') {
    return parkWaitingHuman(store, run, target.id)
  }
  const lineageCycle = Math.max(0, run.lineageCycleBase) + round
  const returnsToVisitedStep = hasWorkflowV2StepVisitedInCycle(
    store.db,
    run.id,
    advance.stepId,
    lineageCycle
  )
  const nextRound = returnsToVisitedStep ? round + 1 : round
  const nextSteps = insertWorkflowV2Steps(store, run, definition, advance.stepId, nextRound)
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'running', waiting_reason = NULL, current_node_id = ?,
           version = version + 1, updated_at = datetime('now') WHERE id = ?`
    )
    .run(advance.stepId, run.id)
  return { nextSteps, terminal: false, waitingHuman: false }
}

export function insertWorkflowV2Steps(
  store: WorkflowV2RuntimeSurface,
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionV2,
  stepId: string,
  round: number,
  attempt = 1
): WorkflowStepRunRecord[] {
  const step = workflowV2StepById(definition, stepId)
  if (!step) {
    throw new WorkflowError('workflow_transition_invalid', `Unknown V2 step ${stepId}`)
  }
  if (step.kind === 'human' || step.kind === 'end') {
    return []
  }
  const assignments = assignmentsForStep(run, step.id)
  if (assignments.length === 0) {
    throw new WorkflowError(
      'workflow_context_mismatch',
      `No agents assigned for V2 step ${step.id}.`
    )
  }
  const node = syntheticV1Node(step)
  return assignments.map((assignment) =>
    store.insertStep(run.id, node, assignment, null, 'queued', round, attempt)
  )
}

function parkWaitingHuman(
  store: WorkflowV2RuntimeSurface,
  run: WorkflowRunRecord,
  stepId: string,
  exhausted?: { exhaustedRouteId?: string; exhaustedTargetStepId?: string }
): WorkflowV2AdvanceResult {
  const context = {
    originDecisionStepId: '',
    originDecisionNodeId: stepId,
    reviewNodeId: stepId,
    artifactRevisionId: '',
    approveTransitionId: 'v2-human',
    reviseTransitionId: 'v2-human',
    v2ExhaustedRouteId: exhausted?.exhaustedRouteId,
    v2ExhaustedTargetStepId: exhausted?.exhaustedTargetStepId
  }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'waiting-human', waiting_reason = 'decision-invalid',
           current_node_id = ?, resolution_context_json = ?,
           version = version + 1, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(stepId, JSON.stringify(context), run.id)
  store.insertEvent(run.id, 'review-waiting', null, {
    schemaVersion: 2,
    stepId,
    waitingReason: 'decision-invalid',
    resolutionContext: context
  })
  return { nextSteps: [], terminal: false, waitingHuman: true }
}

function assignmentsForStep(run: WorkflowRunRecord, stepId: string): WorkflowAgentAssignment[] {
  return run.assignments.filter((assignment) => assignment.nodeId === stepId)
}

/** Map V2 agent/decision onto produce step rows so capture/prepare reuse freeform completion. */
function syntheticV1Node(
  step: Extract<WorkflowDefinitionV2['steps'][number], { kind: 'agent' | 'decision' }>
): WorkflowNodeDefinitionV1 {
  return {
    id: step.id,
    name: step.name,
    type: 'produce',
    roleSlotIds: [...step.roleSlotIds],
    promptTemplateKey: null,
    promptInstructions: null,
    inputBindings: [],
    retryPolicy: {
      maxAttempts: step.retryPolicy.maxAttempts,
      backoffMs: step.retryPolicy.backoffMs,
      onExhausted: step.retryPolicy.onExhausted === 'human' ? 'wait-human' : 'fail-run'
    },
    artifactKind: 'code',
    outputSchema: 'workflow.completion/v1'
  }
}
