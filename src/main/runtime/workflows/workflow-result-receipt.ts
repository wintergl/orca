import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'

export function claimWorkflowResultReceipt(
  store: WorkflowRuntimePersistence,
  runId: string,
  stepRunId: string,
  kind: string,
  sourceReference: unknown
): void {
  const messageId =
    sourceReference &&
    typeof sourceReference === 'object' &&
    typeof (sourceReference as { workerDoneMessageId?: unknown }).workerDoneMessageId === 'string'
      ? (sourceReference as { workerDoneMessageId: string }).workerDoneMessageId
      : null
  if (messageId && !store.claimExternalReceipt({ runId, stepRunId, messageId, kind })) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'The external completion message was already consumed by another Step.'
    )
  }
}
