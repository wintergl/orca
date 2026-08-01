import type Database from '../../sqlite/sync-database'

export function listRecoverableWorkflowRunOwners(
  db: Database.Database
): { runId: string; ownerIdentity: string }[] {
  return db
    .prepare(
      `SELECT id AS runId, owner_identity AS ownerIdentity
       FROM workflow_runs
       WHERE status IN (
         'draft', 'ready', 'running', 'paused', 'waiting-human', 'review-limit-reached'
       )
       ORDER BY created_at`
    )
    .all() as { runId: string; ownerIdentity: string }[]
}

export function acquireWorkflowRecoveryLease(
  db: Database.Database,
  runId: string,
  ownerId: string
): boolean {
  const result = db
    .prepare(
      `INSERT INTO workflow_recovery_leases (run_id, owner_id, expires_at)
       VALUES (?, ?, datetime('now', '+30 seconds'))
       ON CONFLICT(run_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         expires_at = excluded.expires_at,
         acquired_at = datetime('now')
       WHERE workflow_recovery_leases.owner_id = excluded.owner_id
          OR workflow_recovery_leases.expires_at <= datetime('now')`
    )
    .run(runId, ownerId)
  return result.changes === 1
}

export function claimWorkflowExternalReceipt(
  db: Database.Database,
  params: {
    runId: string
    stepRunId: string
    messageId: string
    kind: string
  }
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO workflow_external_receipts (
         run_id, external_message_id, step_run_id, kind
       ) VALUES (?, ?, ?, ?)`
    )
    .run(params.runId, params.messageId, params.stepRunId, params.kind)
  if (result.changes === 1) {
    return true
  }
  const existing = db
    .prepare(
      `SELECT step_run_id FROM workflow_external_receipts
       WHERE run_id = ? AND external_message_id = ?`
    )
    .get(params.runId, params.messageId) as { step_run_id: string } | undefined
  return existing?.step_run_id === params.stepRunId
}
