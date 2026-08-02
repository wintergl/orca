import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  advanceWorkflowCompletionState,
  type WorkflowCompletionReconciliationRecord
} from './workflow-completion-reconciliation-store'
import { decisionFailureCanRetry } from './workflow-decision-failure'
import { recoveryMessageForFailureCode } from './workflow-completion-retry-outbox'
import { reviewFailureCanRetry } from './workflow-review-failure'
import type { WorkflowStore } from './workflow-store'

/** Apply Workflow-side failure write after orchestration has settled. */
export function applyWorkflowFailureWrite(
  params: {
    store: WorkflowStore
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    rawAgentText?: string | null
  },
  code: string,
  message: string,
  record: WorkflowCompletionReconciliationRecord,
  options: { allowRetry: boolean } = { allowRetry: true }
): void {
  const recovery = recoveryMessageForFailureCode(code)
  const decisionCode =
    code === 'workflow_completion_incomplete' ? 'workflow_decision_invalid' : code
  const rawAgentText = params.rawAgentText?.trim() || record.failureDiagnostic?.rawAgentText || null
  const shouldRetry =
    options.allowRetry &&
    (params.step.nodeType === 'decide'
      ? decisionFailureCanRetry(params.run, params.step)
      : params.step.nodeType === 'review'
        ? reviewFailureCanRetry(params.run, params.step)
        : false)

  if (params.step.nodeType === 'review') {
    params.store.failReviewer({
      run: params.run,
      step: params.step,
      code,
      message,
      recovery,
      rawAgentText,
      deferRetry: options.allowRetry,
      skipRetry: !options.allowRetry
    })
  } else if (params.step.nodeType === 'decide') {
    params.store.failDecision({
      run: params.run,
      step: params.step,
      code: decisionCode,
      message,
      recovery: 'Inspect the Decision output, then retry or decide manually.',
      rawAgentText,
      deferRetry: options.allowRetry,
      skipRetry: !options.allowRetry
    })
  } else {
    params.store.failRun({
      runId: params.run.id,
      stepRunId: params.step.id,
      code,
      message,
      recovery,
      rawAgentText,
      incomplete:
        code === 'workflow_completion_incomplete' || code === 'workflow_artifact_unavailable'
    })
  }

  advanceWorkflowCompletionState(
    params.store.persistenceDb,
    record.receiptId,
    'orchestration-settled',
    'workflow-settled',
    {
      retryOutboxState: shouldRetry ? 'pending' : 'none',
      errorCode: decisionCode,
      errorMessage: message
    }
  )
}
