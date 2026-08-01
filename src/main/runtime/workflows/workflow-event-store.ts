import type Database from '../../sqlite/sync-database'
import type {
  WorkflowEventRecord,
  WorkflowEventType,
  WorkflowRunEventsResult
} from '../../../shared/workflow-definition-types'
import { exposeTimestamp } from './workflow-store-records'
import { workflowRecordId, type WorkflowEventRow } from './workflow-runtime-records'

export function listWorkflowEvents(db: Database.Database, runId: string): WorkflowRunEventsResult {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_events WHERE run_id = ?
       ORDER BY CASE WHEN sequence IS NULL THEN 1 ELSE 0 END, sequence, rowid`
    )
    .all(runId) as WorkflowEventRow[]
  return {
    runId,
    events: rows.map(
      (row, index): WorkflowEventRecord => ({
        id: row.id,
        runId: row.run_id,
        sequence: row.sequence ?? index + 1,
        type: row.type,
        stepRunId: row.step_run_id,
        payload: JSON.parse(row.payload_json),
        createdAt: exposeTimestamp(row.created_at)!
      })
    )
  }
}

export function insertWorkflowEvent(
  db: Database.Database,
  runId: string,
  type: WorkflowEventType,
  stepRunId: string | null,
  payload: unknown
): void {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM workflow_events WHERE run_id = ?'
    )
    .get(runId) as { sequence: number }
  db.prepare(
    `INSERT INTO workflow_events (
       id, run_id, sequence, type, step_run_id, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    workflowRecordId('workflow_event'),
    runId,
    row.sequence,
    type,
    stepRunId,
    JSON.stringify(payload)
  )
}
