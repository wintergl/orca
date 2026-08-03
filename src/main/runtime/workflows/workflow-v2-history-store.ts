import type Database from '../../sqlite/sync-database'
import type { WorkflowHistoryEntryV2 } from '../../../shared/workflow-definition-v2-types'
import { workflowRecordId } from './workflow-runtime-records'

export function ensureWorkflowV2HistoryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_v2_history (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_kind TEXT NOT NULL,
      visit INTEGER NOT NULL,
      cycle INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      prompt_text TEXT,
      final_text TEXT NOT NULL,
      agent_outputs_json TEXT NOT NULL DEFAULT '[]',
      decision INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_v2_history_run
      ON workflow_v2_history(run_id, sequence);
  `)
}

export function appendWorkflowV2History(
  db: Database.Database,
  runId: string,
  entry: Omit<WorkflowHistoryEntryV2, 'sequence' | 'createdAt'>
): WorkflowHistoryEntryV2 {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM workflow_v2_history WHERE run_id = ?`
    )
    .get(runId) as { max_sequence: number }
  const sequence = row.max_sequence + 1
  const id = workflowRecordId('workflow_v2_history')
  db.prepare(
    `INSERT INTO workflow_v2_history (
       id, run_id, sequence, step_id, step_name, step_kind, visit, cycle, attempt,
       prompt_text, final_text, agent_outputs_json, decision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    runId,
    sequence,
    entry.stepId,
    entry.stepName,
    entry.stepKind,
    entry.visit,
    entry.cycle,
    entry.attempt,
    entry.promptText,
    entry.finalText,
    JSON.stringify(entry.agentOutputs),
    entry.decision === null ? null : entry.decision ? 1 : 0
  )
  return {
    ...entry,
    sequence,
    createdAt: new Date().toISOString()
  }
}

export function listWorkflowV2History(
  db: Database.Database,
  runId: string
): WorkflowHistoryEntryV2[] {
  const rows = db
    .prepare(`SELECT * FROM workflow_v2_history WHERE run_id = ? ORDER BY sequence ASC`)
    .all(runId) as {
    sequence: number
    step_id: string
    step_name: string
    step_kind: WorkflowHistoryEntryV2['stepKind']
    visit: number
    cycle: number
    attempt: number
    prompt_text: string | null
    final_text: string
    agent_outputs_json: string
    decision: number | null
    created_at: string
  }[]
  return rows.map((row) => ({
    sequence: row.sequence,
    stepId: row.step_id,
    stepName: row.step_name,
    stepKind: row.step_kind,
    visit: row.visit,
    cycle: row.cycle,
    attempt: row.attempt,
    promptText: row.prompt_text,
    finalText: row.final_text,
    agentOutputs: JSON.parse(row.agent_outputs_json) as WorkflowHistoryEntryV2['agentOutputs'],
    decision: row.decision === null ? null : row.decision === 1,
    createdAt: row.created_at.includes('T')
      ? row.created_at
      : `${row.created_at.replace(' ', 'T')}Z`
  }))
}

export function getWorkflowV2RouteTraversalCounts(
  db: Database.Database,
  runId: string
): Record<string, number> {
  const row = db.prepare(`SELECT baseline_json FROM workflow_runs WHERE id = ?`).get(runId) as
    | { baseline_json: string | null }
    | undefined
  if (!row?.baseline_json) {
    return {}
  }
  try {
    const value = JSON.parse(row.baseline_json) as { v2RouteTraversals?: Record<string, number> }
    return value.v2RouteTraversals ?? {}
  } catch {
    return {}
  }
}

export function setWorkflowV2RouteTraversalCounts(
  db: Database.Database,
  runId: string,
  counts: Record<string, number>
): void {
  const row = db.prepare(`SELECT baseline_json FROM workflow_runs WHERE id = ?`).get(runId) as
    | { baseline_json: string | null }
    | undefined
  let base: Record<string, unknown> = {}
  if (row?.baseline_json) {
    try {
      base = JSON.parse(row.baseline_json) as Record<string, unknown>
    } catch {
      base = {}
    }
  }
  base.v2RouteTraversals = counts
  db.prepare(
    `UPDATE workflow_runs SET baseline_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(base), runId)
}
