import { createHash } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import { workflowRecordId } from './workflow-runtime-records'
import {
  parseWorkflowFailureDiagnostic,
  serializeWorkflowFailureDiagnostic,
  type WorkflowFailureDiagnosticPayload
} from './workflow-completion-failure-diagnostic'
import {
  parseWorkflowSuccessPayload,
  serializeWorkflowSuccessPayload,
  type WorkflowSuccessPayload
} from './workflow-completion-success-payload'

export type WorkflowCompletionReconciliationState =
  | 'received'
  | 'orchestration-settled'
  | 'workflow-settled'
  | 'settled'

export type WorkflowRetryOutboxState = 'none' | 'pending' | 'consumed'
export type WorkflowCompletionReconciliationRecord = {
  receiptId: string
  runId: string
  stepRunId: string
  attempt: number
  taskId: string | null
  dispatchId: string | null
  messageDigest: string
  outcome: 'succeeded' | 'failed'
  state: WorkflowCompletionReconciliationState
  retryOutboxState: WorkflowRetryOutboxState
  retryStepRunId: string | null
  retryBlocked: boolean
  errorCode: string | null
  errorMessage: string | null
  /** Recoverable success snapshot; null on failure outcomes or legacy rows. */
  successPayload: WorkflowSuccessPayload | null
  /** Controlled failure diagnostics (raw Agent text); null when absent/legacy. */
  failureDiagnostic: WorkflowFailureDiagnosticPayload | null
  /** Fail-close discriminator; conflict/post-receipt never apply success writes. */
  resolution: WorkflowCompletionResolution
}

export type WorkflowCompletionResolution =
  | 'none'
  | 'conflict-fail-close'
  | 'post-receipt-fail-close'
  | 'waiting-human'

export type ReceiveWorkflowCompletionResult = {
  record: WorkflowCompletionReconciliationRecord
  created: boolean
  /** True when another outcome already owns this attempt. */
  conflict: boolean
}

type ReconciliationRow = {
  receipt_id: string
  run_id: string
  step_run_id: string
  attempt: number
  task_id: string | null
  dispatch_id: string | null
  message_digest: string
  outcome: 'succeeded' | 'failed'
  state: WorkflowCompletionReconciliationState
  retry_outbox_state: WorkflowRetryOutboxState
  retry_step_run_id: string | null
  retry_blocked: number | null
  error_code: string | null
  error_message: string | null
  success_payload_json: string | null
  failure_diagnostic_json: string | null
  resolution: string | null
}

export function digestWorkflowCompletionMessage(parts: {
  stepRunId: string
  attempt: number
  sourceIdentity?: string | null
  text?: string | null
  code?: string | null
  message?: string | null
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        stepRunId: parts.stepRunId,
        attempt: parts.attempt,
        sourceIdentity: parts.sourceIdentity ?? null,
        text: parts.text ?? null,
        code: parts.code ?? null,
        message: parts.message ?? null
      })
    )
    .digest('hex')
}

/** Atomically claim one winner per attempt identity (digest is diagnostic only). */
export function receiveWorkflowCompletion(
  db: Database.Database,
  params: {
    runId: string
    stepRunId: string
    attempt: number
    taskId: string | null
    dispatchId: string | null
    messageDigest: string
    outcome: 'succeeded' | 'failed'
    errorCode?: string | null
    errorMessage?: string | null
    successPayload?: WorkflowSuccessPayload | null
    failureDiagnostic?: WorkflowFailureDiagnosticPayload | null
  }
): ReceiveWorkflowCompletionResult {
  const receiptId = workflowRecordId('workflow_completion')
  const payloadJson = params.successPayload
    ? serializeWorkflowSuccessPayload(params.successPayload)
    : null
  const failureDiagnosticJson = params.failureDiagnostic
    ? serializeWorkflowFailureDiagnostic(params.failureDiagnostic)
    : null
  db.prepare(
    `INSERT INTO workflow_completion_reconciliations (
       receipt_id, run_id, step_run_id, attempt, task_id, dispatch_id,
       message_digest, outcome, state, retry_outbox_state, error_code, error_message,
       success_payload_json, failure_diagnostic_json, resolution
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', 'none', ?, ?, ?, ?, 'none')
     ON CONFLICT(run_id, step_run_id, attempt) DO NOTHING`
  ).run(
    receiptId,
    params.runId,
    params.stepRunId,
    params.attempt,
    params.taskId,
    params.dispatchId,
    params.messageDigest,
    params.outcome,
    params.errorCode ?? null,
    params.errorMessage ?? null,
    payloadJson,
    failureDiagnosticJson
  )
  const row = db
    .prepare(
      `SELECT * FROM workflow_completion_reconciliations
       WHERE run_id = ? AND step_run_id = ? AND attempt = ?`
    )
    .get(params.runId, params.stepRunId, params.attempt) as ReconciliationRow
  const record = toRecord(row)
  const created = record.receiptId === receiptId
  if (created) {
    return { record, created: true, conflict: false }
  }
  return {
    record,
    created: false,
    conflict: record.outcome !== params.outcome
  }
}

export function advanceWorkflowCompletionState(
  db: Database.Database,
  receiptId: string,
  from: WorkflowCompletionReconciliationState,
  to: WorkflowCompletionReconciliationState,
  patch?: {
    retryOutboxState?: WorkflowRetryOutboxState
    retryStepRunId?: string | null
    retryBlocked?: boolean
    errorCode?: string | null
    errorMessage?: string | null
    /** When true, force error_code/error_message to NULL (COALESCE cannot clear). */
    clearErrorDiagnostics?: boolean
    successPayload?: WorkflowSuccessPayload | null
    resolution?: WorkflowCompletionResolution
  }
): WorkflowCompletionReconciliationRecord | null {
  const payloadJson =
    patch?.successPayload === undefined
      ? null
      : patch.successPayload
        ? serializeWorkflowSuccessPayload(patch.successPayload)
        : null
  const result = db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET state = ?,
           retry_outbox_state = COALESCE(?, retry_outbox_state),
           retry_step_run_id = COALESCE(?, retry_step_run_id),
           retry_blocked = CASE WHEN ? IS NULL THEN retry_blocked ELSE ? END,
           error_code = CASE WHEN ? THEN NULL ELSE COALESCE(?, error_code) END,
           error_message = CASE WHEN ? THEN NULL ELSE COALESCE(?, error_message) END,
           success_payload_json = CASE WHEN ? IS NULL THEN success_payload_json ELSE ? END,
           resolution = COALESCE(?, resolution),
           updated_at = datetime('now')
       WHERE receipt_id = ? AND state = ?`
    )
    .run(
      to,
      patch?.retryOutboxState ?? null,
      patch?.retryStepRunId ?? null,
      patch?.retryBlocked === undefined ? null : patch.retryBlocked ? 1 : 0,
      patch?.retryBlocked === undefined ? null : patch.retryBlocked ? 1 : 0,
      patch?.clearErrorDiagnostics ? 1 : 0,
      patch?.errorCode ?? null,
      patch?.clearErrorDiagnostics ? 1 : 0,
      patch?.errorMessage ?? null,
      patch?.successPayload === undefined ? null : 1,
      payloadJson,
      patch?.resolution ?? null,
      receiptId,
      from
    )
  if (result.changes !== 1) {
    return getWorkflowCompletion(db, receiptId)
  }
  return getWorkflowCompletion(db, receiptId)
}

export function getWorkflowCompletion(
  db: Database.Database,
  receiptId: string
): WorkflowCompletionReconciliationRecord | null {
  const row = db
    .prepare('SELECT * FROM workflow_completion_reconciliations WHERE receipt_id = ?')
    .get(receiptId) as ReconciliationRow | undefined
  return row ? toRecord(row) : null
}

export function getWorkflowCompletionByAttempt(
  db: Database.Database,
  params: { runId: string; stepRunId: string; attempt: number }
): WorkflowCompletionReconciliationRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM workflow_completion_reconciliations
       WHERE run_id = ? AND step_run_id = ? AND attempt = ?`
    )
    .get(params.runId, params.stepRunId, params.attempt) as ReconciliationRow | undefined
  return row ? toRecord(row) : null
}

export function listPendingRetryOutbox(
  db: Database.Database,
  runId?: string
): WorkflowCompletionReconciliationRecord[] {
  return runId
    ? queryCompletions(
        db,
        `SELECT * FROM workflow_completion_reconciliations
         WHERE run_id = ? AND state = 'settled' AND retry_outbox_state = 'pending'
         ORDER BY created_at`,
        runId
      )
    : queryCompletions(
        db,
        `SELECT * FROM workflow_completion_reconciliations
         WHERE state = 'settled' AND retry_outbox_state = 'pending'
         ORDER BY created_at`
      )
}

export function listUnsettledCompletions(
  db: Database.Database,
  runId?: string
): WorkflowCompletionReconciliationRecord[] {
  return runId
    ? queryCompletions(
        db,
        `SELECT * FROM workflow_completion_reconciliations
         WHERE run_id = ? AND state != 'settled' ORDER BY created_at`,
        runId
      )
    : queryCompletions(
        db,
        `SELECT * FROM workflow_completion_reconciliations
         WHERE state != 'settled' ORDER BY created_at`
      )
}

function queryCompletions(
  db: Database.Database,
  sql: string,
  ...params: string[]
): WorkflowCompletionReconciliationRecord[] {
  return (db.prepare(sql).all(...params) as ReconciliationRow[]).map(toRecord)
}

function toRecord(row: ReconciliationRow): WorkflowCompletionReconciliationRecord {
  return {
    receiptId: row.receipt_id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    attempt: row.attempt,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    messageDigest: row.message_digest,
    outcome: row.outcome,
    state: row.state,
    retryOutboxState: row.retry_outbox_state,
    retryStepRunId: row.retry_step_run_id,
    retryBlocked: Boolean(row.retry_blocked),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    successPayload: parseWorkflowSuccessPayload(row.success_payload_json),
    failureDiagnostic: parseWorkflowFailureDiagnostic(row.failure_diagnostic_json),
    resolution: parseResolution(row.resolution)
  }
}

function parseResolution(value: string | null | undefined): WorkflowCompletionResolution {
  return value === 'conflict-fail-close' ||
    value === 'post-receipt-fail-close' ||
    value === 'waiting-human'
    ? value
    : 'none'
}
