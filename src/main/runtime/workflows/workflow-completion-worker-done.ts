import type { OrchestrationDb } from '../orchestration/db'
import { reconcileLifecycleMessage } from '../orchestration/lifecycle-reconciliation'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import type { WorkflowPreparedCompletion } from './workflow-completion-prepare'
import { WorkflowError } from './workflow-error'

export type InternalWorkerDoneSettlement = {
  settled: boolean
  failureTerminal: boolean
  messageId: string | null
  duplicate: boolean
}

/** Deterministic message id bound to the success receipt (not random). */
export function workflowWorkerDoneMessageId(receiptId: string): string {
  return `workflow_wd_${receiptId}`
}

/**
 * After success receipt ownership: insert an idempotent internal worker_done and
 * drive Orchestration settlement through lifecycle reconciliation.
 */
export function settleOrchestrationViaInternalWorkerDone(params: {
  runtime: OrcaRuntimeService
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion
  receiptId: string
  messageDigest: string
}): InternalWorkerDoneSettlement {
  const { run, step, prepared, receiptId, messageDigest } = params
  if (!step.taskId || !step.dispatchId || !step.assignment || !run.orchestrationRunId) {
    return { settled: false, failureTerminal: false, messageId: null, duplicate: false }
  }

  const worker = params.orchestration.getWorkerDispatch(step.dispatchId)
  const task = params.orchestration.getTask(step.taskId)
  const dispatch = params.orchestration.getDispatchContextById(step.dispatchId)
  const messageId = workflowWorkerDoneMessageId(receiptId)
  // Always resolve message identity first (including completed-terminal recovery).
  const existing = resolveWorkerDoneMessage(
    params.orchestration,
    run.orchestrationRunId,
    step.taskId,
    step.dispatchId,
    messageId,
    receiptId
  )

  if (
    task?.status === 'failed' ||
    dispatch?.status === 'failed' ||
    (worker && ['failed', 'stopped', 'abandoned'].includes(worker.state))
  ) {
    return {
      settled: false,
      failureTerminal: true,
      messageId: existing?.id ?? null,
      duplicate: true
    }
  }

  if (
    task?.status === 'completed' ||
    dispatch?.status === 'completed' ||
    worker?.state === 'succeeded'
  ) {
    return {
      settled: true,
      failureTerminal: false,
      messageId: existing?.id ?? null,
      duplicate: true
    }
  }

  const resolved = params.runtime.resolveTerminalPane(
    step.assignment.paneKey,
    step.assignment.worktreeId
  )
  assertWorkflowAgentLifecycle(params.runtime, step.assignment, resolved.handle)

  const outcome =
    prepared.value.schema === 'workflow.completion/v1' ? prepared.value.outcome : 'succeeded'
  const message =
    existing ??
    insertWorkerDoneIdempotent(params.orchestration, {
      id: messageId,
      from: resolved.handle,
      to: `run:${run.orchestrationRunId}`,
      subject: 'Workflow result ready',
      body: 'The assigned Workflow Step produced a validated structured result.',
      type: 'worker_done' as const,
      senderPaneKey: step.assignment.paneKey,
      runId: run.orchestrationRunId,
      payload: JSON.stringify({
        taskId: step.taskId,
        dispatchId: step.dispatchId,
        outcome,
        filesModified: prepared.filesModified,
        reportPath: prepared.reportPath,
        provenance: 'workflow_engine',
        receiptId,
        digest: messageDigest
      })
    })

  const reconciliation = reconcileLifecycleMessage(params.orchestration, message)
  if (reconciliation.action === 'rejected') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      `Workflow result completion was rejected: ${reconciliation.reason}`
    )
  }
  if (!existing) {
    params.runtime.notifyMessageArrived?.(`run:${run.orchestrationRunId}`, 'worker_done')
  }
  if (reconciliation.action === 'failed') {
    return {
      settled: false,
      failureTerminal: true,
      messageId: message.id,
      duplicate: Boolean(existing)
    }
  }
  if (reconciliation.action === 'completed') {
    return {
      settled: true,
      failureTerminal: false,
      messageId: message.id,
      duplicate: Boolean(existing)
    }
  }

  const taskAfter = params.orchestration.getTask(step.taskId)
  const workerAfter = params.orchestration.getWorkerDispatch(step.dispatchId)
  if (taskAfter?.status === 'completed' || workerAfter?.state === 'succeeded') {
    return {
      settled: true,
      failureTerminal: false,
      messageId: message.id,
      duplicate: true
    }
  }
  if (
    taskAfter?.status === 'failed' ||
    (workerAfter && ['failed', 'stopped', 'abandoned'].includes(workerAfter.state))
  ) {
    return {
      settled: false,
      failureTerminal: true,
      messageId: message.id,
      duplicate: true
    }
  }
  return {
    settled: false,
    failureTerminal: false,
    messageId: message.id,
    duplicate: Boolean(existing)
  }
}

function resolveWorkerDoneMessage(
  orchestration: OrchestrationDb,
  orchestrationRunId: string,
  taskId: string,
  dispatchId: string,
  messageId: string,
  receiptId: string
) {
  const byId = orchestration.getMessageById(messageId)
  if (byId) {
    return byId
  }
  const messages = orchestration.getRunMailboxHistory(orchestrationRunId, 500, ['worker_done'])
  for (const message of messages) {
    try {
      const payload = JSON.parse(message.payload ?? '{}') as Record<string, unknown>
      if (payload.receiptId === receiptId) {
        return message
      }
      if (payload.taskId === taskId && payload.dispatchId === dispatchId) {
        return message
      }
    } catch {
      // ignore
    }
  }
  return null
}

function insertWorkerDoneIdempotent(
  orchestration: OrchestrationDb,
  msg: {
    id: string
    from: string
    to: string
    subject: string
    body: string
    type: 'worker_done'
    senderPaneKey: string
    runId: string
    payload: string
  }
) {
  try {
    return orchestration.insertMessage(msg)
  } catch (error) {
    const existing = orchestration.getMessageById(msg.id)
    if (existing) {
      return existing
    }
    throw error
  }
}
