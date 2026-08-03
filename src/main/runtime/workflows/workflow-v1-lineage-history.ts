import type Database from '../../sqlite/sync-database'
import type { WorkflowPromptHistoryEntry } from '../../../shared/workflow-prompt-instructions'

export function listWorkflowV1PromptHistoryWithLineage(
  db: Database.Database,
  runId: string,
  excludedStepRunId?: string
): WorkflowPromptHistoryEntry[] {
  const runIds = workflowLineageRunIds(db, runId)
  const history: WorkflowPromptHistoryEntry[] = []
  for (const lineageRunId of runIds) {
    const rows = db
      .prepare(
        `SELECT steps.id, steps.node_id, steps.round, steps.conclusion_markdown,
                runs.lineage_cycle_base
         FROM workflow_step_runs AS steps
         JOIN workflow_runs AS runs ON runs.id = steps.run_id
         WHERE steps.run_id = ? AND steps.status = 'succeeded'
           AND steps.conclusion_markdown IS NOT NULL
         ORDER BY steps.round ASC, steps.created_at ASC, steps.id ASC`
      )
      .all(lineageRunId) as {
      id: string
      node_id: string
      round: number
      conclusion_markdown: string
      lineage_cycle_base: number
    }[]
    for (const row of rows) {
      if (row.id === excludedStepRunId || !row.conclusion_markdown.trim()) {
        continue
      }
      history.push({
        round: Math.max(0, row.lineage_cycle_base) + row.round,
        nodeId: row.node_id,
        output: row.conclusion_markdown,
        sequence: history.length
      })
    }
  }
  return history
}

function workflowLineageRunIds(db: Database.Database, runId: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = runId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    result.unshift(cursor)
    const row = db.prepare(`SELECT parent_run_id FROM workflow_runs WHERE id = ?`).get(cursor) as
      | { parent_run_id: string | null }
      | undefined
    cursor = row?.parent_run_id ?? null
  }
  return result
}
