import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type Database from '../../sqlite/sync-database'
import type { WorkflowMutationHost } from './workflow-completion-retry-outbox'
import { insertV2RetryStep } from './workflow-v2-retry'

/**
 * Returns:
 * - undefined when not a V2 produce outbox item
 * - retry step when claimed
 * - null when lost claim race (winner elsewhere)
 * Throws on insert/storage failure so the outer transaction rolls back and outbox stays pending.
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
  const retry = insertV2RetryStep(
    {
      db,
      getStep: (id) => store.getStep(id) ?? null,
      insertEvent: store.insertEvent.bind(store),
      insertStep: store.insertStep.bind(store),
      finishEngineStep: (stepRunId, envelope, conclusionMarkdown) => {
        db.prepare(
          `UPDATE workflow_step_runs
           SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
               completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
      }
    },
    run,
    failed
  )
  const claimed = db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', retry_step_run_id = ?, updated_at = datetime('now')
       WHERE receipt_id = ? AND state = 'settled' AND retry_outbox_state = 'pending'`
    )
    .run(retry.id, receiptId)
  if (claimed.changes !== 1) {
    db.prepare('DELETE FROM workflow_step_runs WHERE id = ?').run(retry.id)
    return null
  }
  return retry
}
