import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'

export type OrchestrationFailureSettlement = {
  /** Workflow failure write may proceed. */
  settled: boolean
  duplicate: boolean
  /**
   * Orchestration already completed successfully. Failure path must not flip it
   * to failed or schedule a technical retry, but may still fail the Workflow step.
   */
  successTerminal: boolean
}

/**
 * Fail-close the Orchestration task/dispatch for a Workflow attempt before
 * any retry step is created. Success terminals block failure reinterpretation
 * of Orchestration while still allowing the Workflow step to fail closed.
 */
export function settleWorkflowAttemptOrchestrationFailed(
  orchestration: OrchestrationDb,
  step: WorkflowStepRunRecord,
  reason: string
): OrchestrationFailureSettlement {
  // Why: pre-dispatch failures (session/lifecycle) have nothing to settle.
  if (!step.taskId || !step.dispatchId) {
    return { settled: true, duplicate: false, successTerminal: false }
  }
  const worker = orchestration.getWorkerDispatch(step.dispatchId)
  const task = orchestration.getTask(step.taskId)
  const dispatch = orchestration.getDispatchContextById(step.dispatchId)

  // Success already won for Orchestration — do not re-fail it (P0-R4).
  if (
    task?.status === 'completed' ||
    dispatch?.status === 'completed' ||
    worker?.state === 'succeeded'
  ) {
    return { settled: true, duplicate: true, successTerminal: true }
  }

  // Matching failed terminals only — true failure idempotency.
  if (
    task?.status === 'failed' &&
    (!dispatch || dispatch.status === 'failed') &&
    (!worker || ['failed', 'stopped', 'abandoned'].includes(worker.state))
  ) {
    return { settled: true, duplicate: true, successTerminal: false }
  }

  if (worker?.state === 'starting') {
    orchestration.failWorkerStart(step.dispatchId, 'workflow_engine', reason)
    return { settled: true, duplicate: false, successTerminal: false }
  }

  // Why: start_unknown may still recover to ready; auto-retry would race the old agent.
  if (worker && !['ready', 'failed', 'stopped', 'abandoned'].includes(worker.state)) {
    return { settled: false, duplicate: false, successTerminal: false }
  }
  if (!task) {
    return { settled: false, duplicate: false, successTerminal: false }
  }
  if (task.status !== 'dispatched') {
    return { settled: false, duplicate: false, successTerminal: false }
  }
  if (worker && worker.state !== 'ready') {
    return { settled: false, duplicate: false, successTerminal: false }
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
    return {
      settled: true,
      duplicate: settlement.duplicate,
      successTerminal: false
    }
  }
  // Race: concurrent success may have settled while we attempted fail.
  const taskAfter = orchestration.getTask(step.taskId)
  const workerAfter = orchestration.getWorkerDispatch(step.dispatchId)
  if (taskAfter?.status === 'completed' || workerAfter?.state === 'succeeded') {
    return { settled: true, duplicate: true, successTerminal: true }
  }
  return { settled: false, duplicate: false, successTerminal: false }
}
