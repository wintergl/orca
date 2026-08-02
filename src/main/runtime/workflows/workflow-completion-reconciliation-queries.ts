import type Database from '../../sqlite/sync-database'

export function listUnsettledCompletionRunOwners(
  db: Database.Database
): { runId: string; ownerIdentity: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT r.id AS runId, r.owner_identity AS ownerIdentity
       FROM workflow_completion_reconciliations c
       JOIN workflow_runs r ON r.id = c.run_id
       WHERE c.state != 'settled'
          OR (c.state = 'settled' AND c.retry_outbox_state = 'pending')
       ORDER BY r.created_at`
    )
    .all() as { runId: string; ownerIdentity: string }[]
}
