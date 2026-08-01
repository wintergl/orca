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
  // Why: pre-dispatch failures (session/lifecycle) have nothing to settle.
  if (!step.taskId || !step.dispatchId) {
    return { settled: true, duplicate: false }
  }
  const worker = orchestration.getWorkerDispatch(step.dispatchId)
  if (worker?.state === 'starting') {
    orchestration.failWorkerStart(step.dispatchId, 'workflow_engine', reason)
    return { settled: true, duplicate: false }
  }
  // Why: start_unknown may still recover to ready; auto-retry would race the old agent.
  if (worker && !['ready', 'failed', 'succeeded', 'stopped', 'abandoned'].includes(worker.state)) {
    return { settled: false, duplicate: false }
  }
  const task = orchestration.getTask(step.taskId)
  if (!task) {
    return { settled: false, duplicate: false }
  }
  // Why: if Orchestration is already terminal, workflow failure writes may still proceed.
  if (task.status === 'failed' || task.status === 'completed') {
    return { settled: true, duplicate: true }
  }
  if (worker && ['failed', 'succeeded', 'stopped', 'abandoned'].includes(worker.state)) {
    return { settled: true, duplicate: true }
  }
  if (task.status !== 'dispatched') {
    return { settled: false, duplicate: false }
  }
  if (worker && worker.state !== 'ready') {
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
  if (settlement?.action === 'settled') {
    return { settled: true, duplicate: settlement.duplicate }
  }
  return { settled: false, duplicate: false }
}
