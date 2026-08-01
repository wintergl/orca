import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import { settleWorkflowAttemptOrchestrationFailed } from './workflow-attempt-orchestration-settlement'
import {
  advanceWorkflowCompletionState,
  digestWorkflowCompletionMessage,
  getWorkflowCompletion,
  listPendingRetryOutbox,
  listUnsettledCompletions,
  receiveWorkflowCompletion,
  type WorkflowCompletionReconciliationRecord
} from './workflow-completion-reconciliation-store'
import {
  classifyWorkflowStepFailureCode,
  consumeWorkflowRetryOutbox,
  isHumanWaitFailureCode,
  recoveryMessageForFailureCode,
  terminalizeWorkflowStepOwnership
} from './workflow-completion-retry-outbox'
import { decisionFailureCanRetry } from './workflow-decision-failure'
import { reviewFailureCanRetry } from './workflow-review-failure'
import type { WorkflowStore } from './workflow-store'

export type WorkflowFailureReconcileResult = {
  receiptId: string
  retryStep: WorkflowStepRunRecord | null
  waitingHuman: boolean
  duplicate: boolean
  conflict: boolean
}

/**
 * Failure completion path with durable reconciliation + deferred retry outbox.
 * Orchestration is settled before workflow failure writes; retry only after settled.
 */
export function reconcileWorkflowStepFailure(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  error: unknown
}): WorkflowFailureReconcileResult {
  const message = params.error instanceof Error ? params.error.message : String(params.error)
  const code = classifyWorkflowStepFailureCode(params.error, message)
  if (isHumanWaitFailureCode(code)) {
    params.store.markRecoveryWaiting(
      params.run,
      params.step,
      code === 'workflow_lifecycle_mismatch' ? 'lifecycle-mismatch' : 'delivery-uncertain',
      message
    )
    return {
      receiptId: '',
      retryStep: null,
      waitingHuman: true,
      duplicate: false,
      conflict: false
    }
  }

  const db = params.store.persistenceDb
  const digest = digestWorkflowCompletionMessage({
    stepRunId: params.step.id,
    attempt: params.step.attempt,
    code,
    message
  })
  const received = receiveWorkflowCompletion(db, {
    runId: params.run.id,
    stepRunId: params.step.id,
    attempt: params.step.attempt,
    taskId: params.step.taskId,
    dispatchId: params.step.dispatchId,
    messageDigest: digest,
    outcome: 'failed',
    errorCode: code,
    errorMessage: message
  })
  if (received.conflict) {
    // Success (or another outcome) already owns this attempt — stop failure path.
    return {
      receiptId: received.record.receiptId,
      retryStep: null,
      waitingHuman: false,
      duplicate: true,
      conflict: true
    }
  }
  if (!received.created && received.record.state === 'settled') {
    return {
      receiptId: received.record.receiptId,
      retryStep: consumeWorkflowRetryOutbox(params.store, params.run, received.record),
      waitingHuman: false,
      duplicate: true,
      conflict: false
    }
  }

  let current = getWorkflowCompletion(db, received.record.receiptId) ?? received.record
  let blockTechnicalRetry = false
  if (current.state === 'received') {
    const settlement = settleWorkflowAttemptOrchestrationFailed(
      params.orchestration,
      params.step,
      message
    )
    if (!settlement.settled) {
      params.store.markRecoveryWaiting(
        params.run,
        params.step,
        'delivery-uncertain',
        `Could not settle Orchestration ownership before retry: ${message}`
      )
      return {
        receiptId: current.receiptId,
        retryStep: null,
        waitingHuman: true,
        duplicate: false,
        conflict: false
      }
    }
    // Why: Orchestration success must not be flipped, and must not auto-retry.
    blockTechnicalRetry = settlement.successTerminal
    terminalizeWorkflowStepOwnership(params.store, params.run, params.step)
    current =
      advanceWorkflowCompletionState(db, current.receiptId, 'received', 'orchestration-settled') ??
      current
  }

  if (current.state === 'orchestration-settled') {
    applyWorkflowFailureWrite(params, code, message, current, { allowRetry: !blockTechnicalRetry })
    current = getWorkflowCompletion(db, current.receiptId) ?? current
  }

  if (current.state === 'workflow-settled') {
    current =
      advanceWorkflowCompletionState(db, current.receiptId, 'workflow-settled', 'settled') ??
      current
  }

  return {
    receiptId: current.receiptId,
    retryStep:
      current.state === 'settled'
        ? consumeWorkflowRetryOutbox(params.store, params.run, current)
        : null,
    waitingHuman: false,
    duplicate: !received.created,
    conflict: false
  }
}

export function resumeWorkflowCompletionReconciliations(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
}): WorkflowStepRunRecord[] {
  const db = params.store.persistenceDb
  const created: WorkflowStepRunRecord[] = []
  for (const record of listUnsettledCompletions(db, params.run.id)) {
    const step = params.store.getStep(record.stepRunId)
    if (!step) {
      continue
    }
    let blockTechnicalRetry = false
    if (record.state === 'received' && record.outcome === 'failed') {
      const settlement = settleWorkflowAttemptOrchestrationFailed(
        params.orchestration,
        step,
        record.errorMessage ?? 'recovery resume'
      )
      if (!settlement.settled) {
        params.store.markRecoveryWaiting(
          params.run,
          step,
          'delivery-uncertain',
          record.errorMessage ?? 'Could not settle Orchestration on recovery.'
        )
        continue
      }
      blockTechnicalRetry = settlement.successTerminal
      terminalizeWorkflowStepOwnership(params.store, params.run, step)
      advanceWorkflowCompletionState(db, record.receiptId, 'received', 'orchestration-settled')
    }
    const afterOrch = getWorkflowCompletion(db, record.receiptId)
    if (afterOrch?.state === 'orchestration-settled' && afterOrch.outcome === 'failed') {
      applyWorkflowFailureWrite(
        { store: params.store, run: params.run, step },
        afterOrch.errorCode ?? 'workflow_agent_unavailable',
        afterOrch.errorMessage ?? 'recovery resume',
        afterOrch,
        { allowRetry: !blockTechnicalRetry }
      )
    }
    const afterWorkflow = getWorkflowCompletion(db, record.receiptId)
    if (afterWorkflow?.state === 'workflow-settled') {
      advanceWorkflowCompletionState(db, afterWorkflow.receiptId, 'workflow-settled', 'settled')
    }
    const settled = getWorkflowCompletion(db, record.receiptId)
    if (settled?.state === 'settled') {
      const retry = consumeWorkflowRetryOutbox(params.store, params.run, settled)
      if (retry) {
        created.push(retry)
      }
    }
  }
  for (const pending of listPendingRetryOutbox(db, params.run.id)) {
    const retry = consumeWorkflowRetryOutbox(params.store, params.run, pending)
    if (retry) {
      created.push(retry)
    }
  }
  return created
}

function applyWorkflowFailureWrite(
  params: {
    store: WorkflowStore
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
  },
  code: string,
  message: string,
  record: WorkflowCompletionReconciliationRecord,
  options: { allowRetry: boolean } = { allowRetry: true }
): void {
  const recovery = recoveryMessageForFailureCode(code)
  const decisionCode =
    code === 'workflow_completion_incomplete' ? 'workflow_decision_invalid' : code
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
