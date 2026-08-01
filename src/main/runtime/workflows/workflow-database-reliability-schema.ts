import type Database from '../../sqlite/sync-database'

export function createWorkflowReliabilityTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_deliveries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      delivery_kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'prepared', 'delivering', 'delivered', 'uncertain', 'failed'
      )),
      task_id TEXT,
      dispatch_id TEXT,
      receipt_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, step_run_id, attempt, delivery_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_deliveries_run
      ON workflow_deliveries(run_id, created_at);
    CREATE TABLE IF NOT EXISTS workflow_external_receipts (
      run_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(run_id, external_message_id)
    );
    CREATE TABLE IF NOT EXISTS workflow_recovery_leases (
      run_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflow_completion_reconciliations (
      receipt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      task_id TEXT,
      dispatch_id TEXT,
      message_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded', 'failed')),
      state TEXT NOT NULL CHECK(state IN (
        'received', 'orchestration-settled', 'workflow-settled', 'settled'
      )),
      retry_outbox_state TEXT NOT NULL DEFAULT 'none'
        CHECK(retry_outbox_state IN ('none', 'pending', 'consumed')),
      retry_step_run_id TEXT,
      retry_blocked INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, step_run_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_completion_reconciliations_run
      ON workflow_completion_reconciliations(run_id, state, retry_outbox_state);
    CREATE TABLE IF NOT EXISTS workflow_dispatch_ownership (
      logical_execution_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      assignment_key TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      task_id TEXT,
      dispatch_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('active', 'terminal')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_dispatch_ownership_run
      ON workflow_dispatch_ownership(run_id, state);
  `)
  migrateCompletionReconciliationAttemptUniqueness(db)
  migrateCompletionReconciliationRetryBlocked(db)
}

function migrateCompletionReconciliationRetryBlocked(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(workflow_completion_reconciliations)`).all() as {
    name: string
  }[]
  if (columns.length === 0 || columns.some((column) => column.name === 'retry_blocked')) {
    return
  }
  db.exec(
    `ALTER TABLE workflow_completion_reconciliations
     ADD COLUMN retry_blocked INTEGER NOT NULL DEFAULT 0`
  )
}

/** Older builds unique-keyed digests; attempt identity must be the sole winner. */
function migrateCompletionReconciliationAttemptUniqueness(db: Database.Database): void {
  const sql = (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get('workflow_completion_reconciliations') as { sql: string } | undefined
  )?.sql
  if (!sql || !sql.includes('message_digest')) {
    return
  }
  // Only rebuild when the composite unique still includes message_digest.
  if (
    !/UNIQUE\s*\(\s*run_id\s*,\s*step_run_id\s*,\s*attempt\s*,\s*message_digest\s*\)/i.test(sql)
  ) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      ALTER TABLE workflow_completion_reconciliations RENAME TO workflow_completion_reconciliations_legacy;
      CREATE TABLE workflow_completion_reconciliations (
        receipt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_run_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        task_id TEXT,
        dispatch_id TEXT,
        message_digest TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('succeeded', 'failed')),
        state TEXT NOT NULL CHECK(state IN (
          'received', 'orchestration-settled', 'workflow-settled', 'settled'
        )),
        retry_outbox_state TEXT NOT NULL DEFAULT 'none'
          CHECK(retry_outbox_state IN ('none', 'pending', 'consumed')),
        retry_step_run_id TEXT,
        retry_blocked INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, step_run_id, attempt)
      );
      INSERT OR IGNORE INTO workflow_completion_reconciliations (
        receipt_id, run_id, step_run_id, attempt, task_id, dispatch_id, message_digest,
        outcome, state, retry_outbox_state, retry_step_run_id, retry_blocked, error_code,
        error_message, created_at, updated_at
      )
      SELECT receipt_id, run_id, step_run_id, attempt, task_id, dispatch_id, message_digest,
        outcome, state, retry_outbox_state, retry_step_run_id, 0, error_code, error_message,
        created_at, updated_at
      FROM workflow_completion_reconciliations_legacy
      ORDER BY created_at;
      DROP TABLE workflow_completion_reconciliations_legacy;
      CREATE INDEX IF NOT EXISTS idx_workflow_completion_reconciliations_run
        ON workflow_completion_reconciliations(run_id, state, retry_outbox_state);
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
