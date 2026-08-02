import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  advanceWorkflowCompletionState,
  getWorkflowCompletion,
  type WorkflowCompletionReconciliationRecord
} from './workflow-completion-reconciliation-store'
import { applyFailCloseAtomic, isTransientStorageError } from './workflow-completion-success-apply'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import type { WorkflowSuccessReconcileResult } from './workflow-completion-success-reconciler'

export function handleReceivedPhaseError(
  params: {
    store: WorkflowStore
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    duplicate: boolean
  },
  current: WorkflowCompletionReconciliationRecord,
  error: unknown
): WorkflowSuccessReconcileResult {
  if (isTransientStorageError(error)) {
    advanceWorkflowCompletionState(
      params.store.persistenceDb,
      current.receiptId,
      'received',
      'received',
      {
        resolution: 'waiting-human',
        errorCode: 'workflow_delivery_uncertain',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    )
    params.store.markRecoveryWaiting(
      params.run,
      params.step,
      'delivery-uncertain',
      error instanceof Error ? error.message : String(error)
    )
    return {
      receiptId: current.receiptId,
      duplicate: params.duplicate,
      conflict: false,
      nextNodeId: null
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof WorkflowError ? error.code : 'workflow_completion_incomplete'
  const sealed = applyFailCloseAtomic({
    store: params.store,
    run: params.run,
    step: params.step,
    record: current,
    resolution: 'post-receipt-fail-close',
    code,
    message
  })
  return {
    receiptId: sealed.receiptId,
    duplicate: params.duplicate,
    conflict: false,
    nextNodeId: null
  }
}

export function handlePostReceiptError(
  params: {
    store: WorkflowStore
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    duplicate: boolean
  },
  current: WorkflowCompletionReconciliationRecord,
  error: unknown
): WorkflowSuccessReconcileResult {
  const db = params.store.persistenceDb
  if (isTransientStorageError(error)) {
    advanceWorkflowCompletionState(
      db,
      current.receiptId,
      'orchestration-settled',
      'orchestration-settled',
      {
        resolution: 'waiting-human',
        errorCode: 'workflow_delivery_uncertain',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    )
    params.store.markRecoveryWaiting(
      params.run,
      params.step,
      'delivery-uncertain',
      error instanceof Error ? error.message : String(error)
    )
    return {
      receiptId: current.receiptId,
      duplicate: params.duplicate,
      conflict: false,
      nextNodeId: null
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof WorkflowError ? error.code : 'workflow_completion_incomplete'
  const sealed = applyFailCloseAtomic({
    store: params.store,
    run: params.run,
    step: params.step,
    record: current,
    resolution: 'post-receipt-fail-close',
    code,
    message
  })
  return {
    receiptId: sealed.receiptId,
    duplicate: params.duplicate,
    conflict: false,
    nextNodeId: null
  }
}

/**
 * Atomically clear receipt waiting-human and restore Run/Step that markRecoveryWaiting
 * left in delivery-uncertain. Returns refreshed records for success apply (advance).
 */
export function clearWaitingHumanForRetry(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord
): {
  record: WorkflowCompletionReconciliationRecord
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
} {
  if (record.resolution !== 'waiting-human') {
    return { record, run, step }
  }
  if (record.state !== 'received' && record.state !== 'orchestration-settled') {
    return { record, run, step }
  }

  store.transaction(() => {
    advanceWorkflowCompletionState(
      store.persistenceDb,
      record.receiptId,
      record.state,
      record.state,
      { resolution: 'none', clearErrorDiagnostics: true }
    )
    // Restore Step diagnostics left by markRecoveryWaiting (keep non-terminal status).
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs
         SET delivery_state = CASE
               WHEN delivery_state = 'uncertain' THEN 'delivered' ELSE delivery_state END,
             error_code = NULL, error_message = NULL, recovery = NULL,
             updated_at = datetime('now')
         WHERE id = ? AND status IN ('running', 'delivering', 'waiting-agent')`
      )
      .run(step.id)
    // Restore Run only when parked for delivery-uncertain (not other human waits).
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs
         SET status = 'running', waiting_reason = NULL, resolution_context_json = NULL,
             failure_code = NULL, failure_message = NULL, recovery = NULL,
             version = version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'waiting-human' AND waiting_reason = 'delivery-uncertain'`
      )
      .run(run.id)
  })

  const nextRecord =
    getWorkflowCompletion(store.persistenceDb, record.receiptId) ??
    ({ ...record, resolution: 'none', errorCode: null, errorMessage: null } as typeof record)
  const nextStep = store.getStep(step.id) ?? step
  const nextRun = reloadRunControlFields(store, run)
  return { record: nextRecord, run: nextRun, step: nextStep }
}

export function reloadRunControlFields(
  store: WorkflowStore,
  run: WorkflowRunRecord
): WorkflowRunRecord {
  const row = store.persistenceDb
    .prepare(
      `SELECT status, waiting_reason, failure_code, failure_message, recovery, version
       FROM workflow_runs WHERE id = ?`
    )
    .get(run.id) as
    | {
        status: WorkflowRunRecord['status']
        waiting_reason: WorkflowRunRecord['waitingReason']
        failure_code: string | null
        failure_message: string | null
        recovery: string | null
        version: number
      }
    | undefined
  if (!row) {
    return run
  }
  return {
    ...run,
    status: row.status,
    waitingReason: row.waiting_reason,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    recovery: row.recovery,
    version: row.version
  }
}

export function resultFromRecord(
  current: WorkflowCompletionReconciliationRecord,
  duplicate: boolean
): WorkflowSuccessReconcileResult {
  return {
    receiptId: current.receiptId,
    duplicate,
    conflict:
      current.resolution === 'conflict-fail-close' ||
      current.resolution === 'post-receipt-fail-close',
    nextNodeId: null
  }
}
