import type Database from '../../sqlite/sync-database'
import type {
  WorkflowRunHistoryFilter,
  WorkflowRunSummary
} from '../../../shared/workflow-definition-types'
import { exposeTimestamp, type WorkflowRunRow } from './workflow-store-records'

export function listWorkflowRunHistory(
  db: Database.Database,
  filter: WorkflowRunHistoryFilter,
  callerIdentity: string
): WorkflowRunSummary[] {
  const clauses = ['owner_identity = ?']
  const values: Database.BindValue[] = [callerIdentity]
  if (filter.projectIdentity) {
    clauses.push('project_identity = ?')
    values.push(filter.projectIdentity)
  }
  if (filter.workspace) {
    clauses.push('workspace_kind = ?', 'workspace_id = ?')
    values.push(filter.workspace.kind, filter.workspace.id)
  }
  if (filter.templateId) {
    clauses.push('template_id = ?')
    values.push(filter.templateId)
  }
  if (filter.statuses?.length) {
    clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`)
    values.push(...filter.statuses)
  }
  if (filter.createdFrom) {
    clauses.push('created_at >= datetime(?)')
    values.push(filter.createdFrom)
  }
  if (filter.createdTo) {
    clauses.push('created_at <= datetime(?)')
    values.push(filter.createdTo)
  }
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  const rows = db
    .prepare(
      `SELECT * FROM workflow_runs WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(...values, limit) as WorkflowRunRow[]
  return rows.map(toWorkflowRunSummary)
}

function toWorkflowRunSummary(row: WorkflowRunRow): WorkflowRunSummary {
  const rootRunId = row.root_run_id?.trim() || row.id
  return {
    id: row.id,
    status: row.status,
    templateId: row.template_id,
    templateVersion: row.template_version,
    templateName: row.template_name,
    projectIdentity: row.project_identity,
    workspace: { kind: row.workspace_kind, id: row.workspace_id },
    executionHostId: row.execution_host_id,
    objective: row.objective,
    currentNodeId: row.current_node_id,
    waitingReason: row.waiting_reason,
    parentRunId: row.parent_run_id ?? null,
    rootRunId,
    isRerun: Boolean(row.parent_run_id),
    startedAt: exposeTimestamp(row.started_at),
    completedAt: exposeTimestamp(row.completed_at),
    createdAt: exposeTimestamp(row.created_at)!,
    updatedAt: exposeTimestamp(row.updated_at)!
  }
}
