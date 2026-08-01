import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'

/**
 * Fail-close the Orchestration task/dispatch for a Workflow attempt before
 * any retry step is created. Idempotent when already settled to failed.
 */
export function settleWorkflowAttemptOrchestrationFailed(
  orchestration: OrchestrationDb,
  step: WorkflowStepRunRecord,
  reason: string
): { settled: boolean; duplicate: boolean } {
  if (!step.taskId || !step.dispatchId) {
    return { settled: false, duplicate: false }
  }
  const worker = orchestration.getWorkerDispatch(step.dispatchId)
  if (worker?.state === 'starting') {
    orchestration.failWorkerStart(step.dispatchId, 'workflow_engine', reason)
    return { settled: true, duplicate: false }
  }
  const task = orchestration.getTask(step.taskId)
  if (!task) {
    return { settled: false, duplicate: false }
  }
  if (task.status === 'failed') {
    const dispatch = orchestration.getDispatchContextById(step.dispatchId)
    if (dispatch?.status === 'failed') {
      return { settled: true, duplicate: true }
    }
  }
  if (task.status !== 'dispatched') {
    return { settled: false, duplicate: false }
  }
  const result = JSON.stringify({
    provenance: 'workflow_engine',
    outcome: 'failed',
    reason,
    stepRunId: step.id,
    attempt: step.attempt,
    completedAt: new Date().toISOString()
  })
  const settlement = orchestration.settleWorkerReport({
    taskId: step.taskId,
    dispatchId: step.dispatchId,
    outcome: 'failed',
    result
  })
  if (settlement.action === 'settled') {
    return { settled: true, duplicate: settlement.duplicate }
  }
  return { settled: false, duplicate: false }
}
