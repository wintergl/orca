import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type Database from '../../sqlite/sync-database'
import type { WorkflowMutationHost } from './workflow-completion-retry-outbox'
import { insertV2RetryStep, publishV2RetryStep } from './workflow-v2-retry'

/**
 * Returns:
 * - undefined when not a V2 produce outbox item
 * - retry step when claimed and published
 * - null when lost claim race or already consumed
 * Throws on insert/storage failure so the outer transaction rolls back and outbox stays pending.
 *
 * Order: re-check pending → insert Step → CAS outbox → publish event/Run.
 * CAS losers delete only the Step (no step-retried / Run version).
 */
export function tryConsumeV2RetryOutbox(
  store: WorkflowMutationHost,
  db: Database.Database,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord,
  receiptId: string
): WorkflowStepRunRecord | null | undefined {
  if (
    failed.nodeType !== 'produce' ||
    (run.templateSnapshot as { schemaVersion?: number }).schemaVersion !== 2
  ) {
    return undefined
  }
  const current = db
    .prepare(
      `SELECT retry_outbox_state, retry_step_run_id FROM workflow_completion_reconciliations
       WHERE receipt_id = ?`
    )
    .get(receiptId) as { retry_outbox_state: string; retry_step_run_id: string | null } | undefined
  if (!current) {
    return null
  }
  if (current.retry_outbox_state === 'consumed' && current.retry_step_run_id) {
    return store.getStep(current.retry_step_run_id)
  }
  if (current.retry_outbox_state !== 'pending') {
    return null
  }
  const host = {
    db,
    getStep: (id: string) => store.getStep(id) ?? null,
    insertEvent: store.insertEvent.bind(store),
    insertStep: store.insertStep.bind(store),
    finishEngineStep: (stepRunId: string, envelope: unknown, conclusionMarkdown: string) => {
      db.prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
             completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
    }
  }
  const retry = insertV2RetryStep(host, run, failed)
  const claimed = db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', retry_step_run_id = ?, updated_at = datetime('now')
       WHERE receipt_id = ? AND state = 'settled' AND retry_outbox_state = 'pending'`
    )
    .run(retry.id, receiptId)
  if (claimed.changes !== 1) {
    db.prepare('DELETE FROM workflow_step_runs WHERE id = ?').run(retry.id)
    const winner = db
      .prepare(
        `SELECT retry_step_run_id FROM workflow_completion_reconciliations WHERE receipt_id = ?`
      )
      .get(receiptId) as { retry_step_run_id: string | null } | undefined
    return winner?.retry_step_run_id ? store.getStep(winner.retry_step_run_id) : null
  }
  return publishV2RetryStep(host, run, failed, retry)
}
