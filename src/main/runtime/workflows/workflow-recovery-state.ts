import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'

export type WorkflowRecoveryWaitingReason =
  | 'delivery-uncertain'
  | 'lifecycle-mismatch'
  | 'transport-disconnected'

export function markWorkflowRecoveryWaiting(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  reason: WorkflowRecoveryWaitingReason,
  message: string
): void {
  store.transaction(() => {
    const context = {
      originDecisionStepId: step.id,
      originDecisionNodeId: step.nodeId,
      reviewNodeId: step.nodeType === 'review' ? step.nodeId : 'not-yet-created',
      artifactRevisionId: step.inputArtifactRevisionId ?? 'artifact-unavailable',
      approveTransitionId: 'run-resolution:unavailable',
      reviseTransitionId: 'run-resolution:retry-step'
    }
    const errorCode = `workflow_${reason.replaceAll('-', '_')}`
    store.db
      .prepare(
        `UPDATE workflow_step_runs SET delivery_state = 'uncertain',
           error_code = ?, error_message = ?,
           recovery = 'Inspect delivery evidence before retrying.',
           updated_at = datetime('now') WHERE id = ?`
      )
      .run(errorCode, message, step.id)
    store.db
      .prepare(
        `UPDATE workflow_deliveries SET status = 'uncertain', updated_at = datetime('now')
         WHERE step_run_id = ? AND delivery_kind = 'prompt'`
      )
      .run(step.id)
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = ?,
           resolution_context_json = ?, failure_code = ?,
           failure_message = ?, recovery = 'Inspect delivery evidence before retrying.',
           version = version + 1, updated_at = datetime('now') WHERE id = ?`
      )
      .run(reason, JSON.stringify(context), errorCode, message, run.id)
    store.insertEvent(run.id, 'recovery-waiting', step.id, {
      reason,
      message,
      taskId: step.taskId,
      dispatchId: step.dispatchId
    })
  })
}

export function recordWorkflowRunRecovered(
  store: WorkflowRuntimePersistence,
  runId: string,
  stepRunId: string | null,
  payload: unknown
): void {
  store.transaction(() => {
    store.insertEvent(runId, 'run-recovered', stepRunId, payload)
  })
}
