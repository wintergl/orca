import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  advanceWorkflowCompletionState,
  getWorkflowCompletion,
  type WorkflowCompletionReconciliationRecord
} from './workflow-completion-reconciliation-store'
import type { WorkflowPreparedCompletion } from './workflow-completion-prepare'
import {
  applyFailCloseAtomic,
  applyWorkflowSuccessWriteAtomic,
  ensureProduceArtifact
} from './workflow-completion-success-apply'
import {
  clearWaitingHumanForRetry,
  handlePostReceiptError,
  handleReceivedPhaseError,
  reloadRunControlFields,
  resultFromRecord
} from './workflow-completion-success-errors'
import type { WorkflowSuccessPayload } from './workflow-completion-success-payload'
import { settleOrchestrationViaInternalWorkerDone } from './workflow-completion-worker-done'
import { terminalizeWorkflowStepOwnership } from './workflow-completion-retry-outbox'
import type { WorkflowStore } from './workflow-store'
import type { WorkflowSuccessReconcileResult } from './workflow-completion-success-reconciler'

export async function continueSuccessReconciliation(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion | null
  record: WorkflowCompletionReconciliationRecord
  duplicate: boolean
}): Promise<WorkflowSuccessReconcileResult> {
  const db = params.store.persistenceDb
  const restored = clearWaitingHumanForRetry(params.store, params.run, params.step, params.record)
  let current = restored.record
  let run = restored.run
  let step = restored.step
  let nextNodeId: string | null = null
  const ctx = { ...params, run, step }

  if (
    current.resolution === 'conflict-fail-close' ||
    current.resolution === 'post-receipt-fail-close'
  ) {
    current = applyFailCloseAtomic({
      store: params.store,
      run,
      step,
      record: current,
      resolution: current.resolution,
      code: current.errorCode ?? 'workflow_outcome_conflict',
      message:
        current.errorMessage ??
        'Success receipt previously resolved as fail-close against Orchestration.'
    })
    return {
      receiptId: current.receiptId,
      duplicate: true,
      conflict: true,
      nextNodeId: null
    }
  }

  if (current.state === 'received') {
    try {
      current = await settleReceivedSuccess(ctx, current)
    } catch (error) {
      return handleReceivedPhaseError(ctx, current, error)
    }
    if (current.state !== 'orchestration-settled' || current.resolution !== 'none') {
      return resultFromRecord(current, params.duplicate)
    }
  }

  if (current.state === 'orchestration-settled' && current.resolution === 'none') {
    try {
      current = await ensureProduceArtifact(params.store, run, step, current)
      // Re-read run after any restore so advance uses live status (running).
      run = reloadRunControlFields(params.store, run)
      nextNodeId = applyWorkflowSuccessWriteAtomic(params.store, run, step, current)
      current = getWorkflowCompletion(db, current.receiptId) ?? current
    } catch (error) {
      return handlePostReceiptError(ctx, current, error)
    }
  }

  if (current.state === 'workflow-settled') {
    current =
      advanceWorkflowCompletionState(db, current.receiptId, 'workflow-settled', 'settled') ??
      current
  }

  return {
    receiptId: current.receiptId,
    duplicate: params.duplicate,
    conflict: false,
    nextNodeId
  }
}

export function preparedFromRecord(
  record: WorkflowCompletionReconciliationRecord
): WorkflowPreparedCompletion | null {
  const payload = record.successPayload
  if (!payload) {
    return null
  }
  const reportPath =
    payload.sourceReference &&
    typeof payload.sourceReference === 'object' &&
    typeof (payload.sourceReference as { reportPath?: unknown }).reportPath === 'string'
      ? (payload.sourceReference as { reportPath: string }).reportPath
      : ''
  return {
    value: payload.value as WorkflowPreparedCompletion['value'],
    source: payload.source,
    digest: record.messageDigest,
    sourceIdentity: payload.sourceIdentity,
    sourceReference: {
      reportPath,
      preparedAt: new Date().toISOString()
    },
    warnings: payload.warnings,
    filesModified: payload.filesModified,
    reportPath
  }
}

async function settleReceivedSuccess(
  params: {
    store: WorkflowStore
    orchestration: OrchestrationDb
    runtime: OrcaRuntimeService
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    prepared: WorkflowPreparedCompletion | null
  },
  current: WorkflowCompletionReconciliationRecord
): Promise<WorkflowCompletionReconciliationRecord> {
  const db = params.store.persistenceDb
  if (!params.prepared) {
    advanceWorkflowCompletionState(db, current.receiptId, 'received', 'received', {
      resolution: 'waiting-human',
      errorCode: 'workflow_delivery_uncertain',
      errorMessage:
        'Success receipt is missing its prepared result snapshot for Orchestration settlement.'
    })
    params.store.markRecoveryWaiting(
      params.run,
      params.step,
      'delivery-uncertain',
      'Success receipt is missing its prepared result snapshot for Orchestration settlement.'
    )
    return getWorkflowCompletion(db, current.receiptId) ?? current
  }
  const settlement = settleOrchestrationViaInternalWorkerDone({
    runtime: params.runtime,
    orchestration: params.orchestration,
    run: params.run,
    step: params.step,
    prepared: params.prepared,
    receiptId: current.receiptId,
    messageDigest: current.messageDigest
  })
  if (settlement.failureTerminal) {
    return applyFailCloseAtomic({
      store: params.store,
      run: params.run,
      step: params.step,
      record: current,
      resolution: 'conflict-fail-close',
      code: 'workflow_outcome_conflict',
      message:
        'Orchestration already failed for this attempt; success receipt lost the outcome race.'
    })
  }
  if (!settlement.settled) {
    advanceWorkflowCompletionState(db, current.receiptId, 'received', 'received', {
      resolution: 'waiting-human',
      errorCode: 'workflow_delivery_uncertain',
      errorMessage: 'Could not settle Orchestration success before Workflow write.'
    })
    params.store.markRecoveryWaiting(
      params.run,
      params.step,
      'delivery-uncertain',
      'Could not settle Orchestration success before Workflow write.'
    )
    return getWorkflowCompletion(db, current.receiptId) ?? current
  }
  if (settlement.messageId && current.successPayload) {
    const patched: WorkflowSuccessPayload = {
      ...current.successPayload,
      sourceReference: {
        ...(typeof current.successPayload.sourceReference === 'object' &&
        current.successPayload.sourceReference
          ? (current.successPayload.sourceReference as Record<string, unknown>)
          : {}),
        workerDoneMessageId: settlement.messageId
      }
    }
    advanceWorkflowCompletionState(db, current.receiptId, 'received', 'received', {
      successPayload: patched
    })
    current = getWorkflowCompletion(db, current.receiptId) ?? current
  }
  terminalizeWorkflowStepOwnership(params.store, params.run, params.step)
  return (
    advanceWorkflowCompletionState(db, current.receiptId, 'received', 'orchestration-settled', {
      resolution: 'none'
    }) ?? current
  )
}
