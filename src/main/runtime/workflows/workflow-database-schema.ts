import type Database from '../../sqlite/sync-database'
import {
  backfillWorkflowEventSequences,
  migrateWorkflowEventTable,
  migrateWorkflowRunTable,
  migrateWorkflowStepRunTable,
  migrateWorkflowStepRunReliability
} from './workflow-database-migrations'
import { createWorkflowReliabilityTables } from './workflow-database-reliability-schema'

const RUN_STATUS_CHECK =
  "CHECK(status IN ('draft', 'ready', 'running', 'paused', 'waiting-human', 'review-limit-reached', 'cancelled', 'completed', 'failed'))"

export function createWorkflowTables(db: Database.Database): void {
  createTemplateTables(db)
  createRunTable(db)
  migrateWorkflowRunTable(db)
  createAssignmentTable(db)
  createEventTable(db)
  migrateWorkflowEventTable(db)
  backfillWorkflowEventSequences(db)
  createEventIndex(db)
  createRuntimeTables(db)
  migrateWorkflowStepRunTable(db)
  migrateWorkflowStepRunReliability(db)
  createWorkflowReliabilityTables(db)
  createMutationLedger(db)
}

function createTemplateTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('built-in', 'personal', 'project')),
      owner_identity TEXT NOT NULL,
      project_identity TEXT,
      archived_at TEXT,
      archived_by TEXT,
      current_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_template_active_name
      ON workflow_templates(scope, owner_identity, ifnull(project_identity, ''), name)
      WHERE archived_at IS NULL;
    CREATE TABLE IF NOT EXISTS workflow_template_versions (
      template_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(template_id, version)
    );
  `)
}

function createRunTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
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
    );
  `)
}

function createAssignmentTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_agent_assignments (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      execution_host_id TEXT NOT NULL,
      pane_key TEXT NOT NULL,
      agent_lifecycle_id TEXT NOT NULL,
      provider_session_id TEXT,
      runtime_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(run_id, node_id, slot_id, agent_lifecycle_id)
    );
  `)
}

function createEventTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER,
      type TEXT NOT NULL,
      step_run_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function createEventIndex(db: Database.Database): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_event_sequence
      ON workflow_events(run_id, sequence) WHERE sequence IS NOT NULL;
  `)
}

function createRuntimeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_step_runs (
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
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_run
      ON workflow_step_runs(run_id, created_at);
    CREATE TABLE IF NOT EXISTS workflow_messages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('prompt', 'completion', 'review-result')),
      content_json TEXT,
      markdown TEXT,
      source TEXT,
      digest TEXT NOT NULL,
      source_identity TEXT,
      source_reference_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_step
      ON workflow_messages(step_run_id, created_at);
    CREATE TABLE IF NOT EXISTS workflow_blobs (
      blob_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflow_artifact_revisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('spec', 'code', 'review-report', 'test-report')),
      revision INTEGER NOT NULL,
      execution_host_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      locator_json TEXT NOT NULL,
      digest TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      snapshot_state TEXT NOT NULL CHECK(snapshot_state IN ('frozen', 'drifted', 'unavailable')),
      produced_by_step_run_id TEXT NOT NULL,
      materialized_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, kind, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_run
      ON workflow_artifact_revisions(run_id, revision);
    CREATE TABLE IF NOT EXISTS workflow_review_aggregates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      review_node_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      artifact_revision_id TEXT NOT NULL,
      reviewer_step_run_ids_json TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('approve', 'revise', 'request-human')),
      conflicts_json TEXT NOT NULL,
      waiting_reason TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, review_node_id, round, artifact_revision_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_review_aggregates_run
      ON workflow_review_aggregates(run_id, round, created_at);
    CREATE TABLE IF NOT EXISTS workflow_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_run_id TEXT NOT NULL,
      review_aggregate_id TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      deterministic_decision TEXT NOT NULL CHECK(deterministic_decision IN (
        'approve', 'revise', 'request-human', 'stop-at-review'
      )),
      final_decision TEXT NOT NULL CHECK(final_decision IN (
        'approve', 'revise', 'request-human', 'stop-at-review'
      )),
      source TEXT NOT NULL CHECK(source IN ('rules', 'agent', 'human')),
      input_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_decisions_run
      ON workflow_decisions(run_id, created_at);
    CREATE TABLE IF NOT EXISTS workflow_human_actions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      offer_json TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_identity TEXT NOT NULL,
      permission TEXT NOT NULL,
      reason TEXT,
      before_status TEXT NOT NULL,
      after_status TEXT NOT NULL,
      aggregate_id TEXT,
      artifact_revision_id TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_human_actions_run
      ON workflow_human_actions(run_id, created_at);
  `)
}

function createMutationLedger(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mutation_receipts (
      caller_fingerprint TEXT NOT NULL,
      request_id TEXT NOT NULL,
      method TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'completed')),
      receipt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(caller_fingerprint, request_id)
    );
  `)
}
