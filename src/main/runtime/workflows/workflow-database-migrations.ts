import type Database from '../../sqlite/sync-database'

const RUN_STATUS_CHECK =
  "CHECK(status IN ('draft', 'ready', 'running', 'paused', 'waiting-human', 'review-limit-reached', 'cancelled', 'completed', 'failed'))"

export function migrateWorkflowRunTable(db: Database.Database): void {
  const initialSql = tableSql(db, 'workflow_runs')
  if (!initialSql) {
    return
  }
  if (!initialSql.includes("'running'")) {
    migrateLegacyWorkflowRunTable(db)
  }
  migrateWorkflowRunWaitingState(db)
}

function migrateLegacyWorkflowRunTable(db: Database.Database): void {
  inTransaction(db, () => {
    db.exec(`
        ALTER TABLE workflow_runs RENAME TO workflow_runs_m1;
        ${workflowRunTableSql()}
        INSERT INTO workflow_runs (
          id, status, version, template_id, template_version, template_name,
          template_snapshot_json, owner_identity, project_identity, workspace_kind,
          workspace_id, execution_host_id, objective, created_at, updated_at
        )
        SELECT id, status, version, template_id, template_version, template_name,
          template_snapshot_json, owner_identity, project_identity, workspace_kind,
          workspace_id, execution_host_id, objective, created_at, updated_at
        FROM workflow_runs_m1;
        DROP TABLE workflow_runs_m1;
      `)
  })
}

function migrateWorkflowRunWaitingState(db: Database.Database): void {
  const sql = tableSql(db, 'workflow_runs')
  if (
    sql?.includes("'review-limit-reached'") &&
    hasColumn(db, 'workflow_runs', 'review_round_extensions_json')
  ) {
    return
  }
  const hasWaitingState = hasColumn(db, 'workflow_runs', 'waiting_reason')
  inTransaction(db, () => {
    db.exec(
      `
        ALTER TABLE workflow_runs RENAME TO workflow_runs_m2;
        ${workflowRunTableSql()}
        INSERT INTO workflow_runs (
          id, status, version, template_id, template_version, template_name,
          template_snapshot_json, owner_identity, project_identity, workspace_kind,
          workspace_id, execution_host_id, objective, current_node_id, orchestration_run_id,
          waiting_reason, resolution_context_json, review_rounds_json,
          review_round_extensions_json, baseline_json, failure_code, failure_message,
          recovery, started_at, completed_at,
          created_at, updated_at
        )
        SELECT id, status, version, template_id, template_version, template_name,
          template_snapshot_json, owner_identity, project_identity, workspace_kind,
          workspace_id, execution_host_id, objective, current_node_id, orchestration_run_id,
          ${hasWaitingState ? 'waiting_reason, resolution_context_json' : 'NULL, NULL'},
          '{}', '{}', baseline_json, failure_code, failure_message, recovery, started_at, completed_at,
          created_at, updated_at
        FROM workflow_runs_m2;
        DROP TABLE workflow_runs_m2;
      `
    )
  })
}

function workflowRunTableSql(): string {
  return `CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft' ${RUN_STATUS_CHECK},
    version INTEGER NOT NULL DEFAULT 1,
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    template_snapshot_json TEXT NOT NULL,
    owner_identity TEXT NOT NULL,
    project_identity TEXT NOT NULL,
    workspace_kind TEXT NOT NULL CHECK(workspace_kind IN ('git-worktree', 'folder-workspace')),
    workspace_id TEXT NOT NULL,
    execution_host_id TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    current_node_id TEXT,
    orchestration_run_id TEXT,
    waiting_reason TEXT,
    resolution_context_json TEXT,
    review_rounds_json TEXT NOT NULL DEFAULT '{}',
    review_round_extensions_json TEXT NOT NULL DEFAULT '{}',
    baseline_json TEXT,
    failure_code TEXT,
    failure_message TEXT,
    recovery TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`
}

export function migrateWorkflowStepRunTable(db: Database.Database): void {
  const sql = tableSql(db, 'workflow_step_runs')
  if (
    !sql ||
    (hasColumn(db, 'workflow_step_runs', 'assignment_key') && sql.includes("'cancelled'"))
  ) {
    return
  }
  inTransaction(db, () => {
    db.exec(`
      DROP INDEX IF EXISTS idx_workflow_steps_run;
      ALTER TABLE workflow_step_runs RENAME TO workflow_step_runs_m2;
      CREATE TABLE workflow_step_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_name TEXT NOT NULL,
        node_type TEXT NOT NULL,
        round INTEGER NOT NULL DEFAULT 1,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN (
          'queued', 'waiting-agent', 'delivering', 'running',
          'completion-incomplete', 'succeeded', 'timed-out', 'cancelled', 'failed'
        )),
        assignment_json TEXT,
        assignment_key TEXT NOT NULL DEFAULT 'engine',
        orchestration_run_id TEXT,
        task_id TEXT,
        dispatch_id TEXT,
        delivery_id TEXT NOT NULL,
        delivery_state TEXT NOT NULL DEFAULT 'prepared' CHECK(delivery_state IN (
          'prepared', 'delivering', 'delivered', 'uncertain', 'failed'
        )),
        prompt TEXT NOT NULL DEFAULT '',
        conclusion_markdown TEXT,
        result_envelope_json TEXT,
        message_source TEXT,
        message_digest TEXT,
        source_identity TEXT,
        source_warnings_json TEXT NOT NULL DEFAULT '[]',
        input_artifact_revision_id TEXT,
        output_artifact_revision_id TEXT,
        review_guard_digest TEXT,
        error_code TEXT,
        error_message TEXT,
        recovery TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, node_id, round, attempt, assignment_key),
        UNIQUE(delivery_id)
      );
      INSERT INTO workflow_step_runs (
        id, run_id, node_id, node_name, node_type, round, attempt, status,
        assignment_json, assignment_key, orchestration_run_id, task_id, dispatch_id,
        delivery_id, delivery_state, prompt, conclusion_markdown, result_envelope_json, message_source,
        message_digest, source_identity, source_warnings_json, input_artifact_revision_id,
        output_artifact_revision_id, review_guard_digest, error_code, error_message,
        recovery, started_at, completed_at, created_at, updated_at
      )
      SELECT id, run_id, node_id, node_name, node_type, round, attempt, status,
        assignment_json,
        COALESCE(json_extract(assignment_json, '$.slotId') || ':' ||
          json_extract(assignment_json, '$.agentLifecycleId'), 'engine'),
        orchestration_run_id, task_id, dispatch_id, delivery_id,
        CASE WHEN status = 'running' OR status = 'succeeded' THEN 'delivered'
          WHEN status = 'delivering' THEN 'delivering' ELSE 'prepared' END,
        prompt,
        conclusion_markdown, result_envelope_json, message_source, message_digest,
        source_identity, source_warnings_json, input_artifact_revision_id,
        output_artifact_revision_id, review_guard_digest, error_code, error_message,
        recovery, started_at, completed_at, created_at, updated_at
      FROM workflow_step_runs_m2;
      DROP TABLE workflow_step_runs_m2;
      CREATE INDEX idx_workflow_steps_run ON workflow_step_runs(run_id, created_at);
    `)
  })
}

export function migrateWorkflowStepRunReliability(db: Database.Database): void {
  if (
    !tableSql(db, 'workflow_step_runs') ||
    hasColumn(db, 'workflow_step_runs', 'delivery_state')
  ) {
    return
  }
  db.exec(
    `ALTER TABLE workflow_step_runs
     ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'prepared'
     CHECK(delivery_state IN ('prepared', 'delivering', 'delivered', 'uncertain', 'failed'))`
  )
  db.exec(
    `UPDATE workflow_step_runs SET delivery_state = CASE
       WHEN status IN ('running', 'succeeded') THEN 'delivered'
       WHEN status = 'delivering' THEN 'delivering'
       WHEN status IN ('failed', 'timed-out', 'completion-incomplete') THEN 'failed'
       ELSE 'prepared' END`
  )
}

export function migrateWorkflowEventTable(db: Database.Database): void {
  const sql = tableSql(db, 'workflow_events')
  if (!sql || (!sql.includes('CHECK(type IN') && sql.includes('sequence INTEGER'))) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_workflow_event_sequence;
      ALTER TABLE workflow_events RENAME TO workflow_events_m1;
      CREATE TABLE workflow_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER,
        type TEXT NOT NULL,
        step_run_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO workflow_events (id, run_id, type, payload_json, created_at)
      SELECT id, run_id, type, payload_json, created_at FROM workflow_events_m1;
      DROP TABLE workflow_events_m1;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function backfillWorkflowEventSequences(db: Database.Database): void {
  db.exec(`
    WITH ranked AS (
      SELECT pending.id,
        COALESCE((
          SELECT MAX(existing.sequence)
          FROM workflow_events existing
          WHERE existing.run_id = pending.run_id
        ), 0) + ROW_NUMBER() OVER (
          PARTITION BY pending.run_id ORDER BY pending.rowid
        ) AS assigned_sequence
      FROM workflow_events pending
      WHERE pending.sequence IS NULL
    )
    UPDATE workflow_events
    SET sequence = (
      SELECT assigned_sequence FROM ranked WHERE ranked.id = workflow_events.id
    )
    WHERE sequence IS NULL;
  `)
}

function tableSql(db: Database.Database, name: string): string | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { sql: string } | undefined
  return row?.sql ?? null
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function inTransaction(db: Database.Database, operation: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    operation()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
