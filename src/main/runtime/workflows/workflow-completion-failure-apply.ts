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
import { isWorkflowV2Run } from './workflow-v2-completion'
import { applyWorkflowV2StepFailure, workflowV2FailureCanRetry } from './workflow-v2-retry'

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
    (isWorkflowV2Run(params.run)
      ? workflowV2FailureCanRetry(params.run, params.step)
      : params.step.nodeType === 'decide'
        ? decisionFailureCanRetry(params.run, params.step)
        : params.step.nodeType === 'review'
          ? reviewFailureCanRetry(params.run, params.step)
          : false)

  if (isWorkflowV2Run(params.run) && params.step.nodeType === 'produce') {
    applyWorkflowV2StepFailure(
      {
        db: params.store.persistenceDb,
        getStep: (id) => params.store.getStep(id) ?? null,
        insertEvent: params.store.insertEvent.bind(params.store),
        insertStep: params.store.insertStep.bind(params.store),
        finishEngineStep: (stepRunId, envelope, conclusionMarkdown) => {
          params.store.persistenceDb
            .prepare(
              `UPDATE workflow_step_runs
               SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
                   completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
            )
            .run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
        }
      },
      {
        run: params.run,
        step: params.step,
        code,
        message,
        recovery,
        rawAgentText,
        deferRetry: options.allowRetry,
        skipRetry: !options.allowRetry
      }
    )
  } else if (params.step.nodeType === 'review') {
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
