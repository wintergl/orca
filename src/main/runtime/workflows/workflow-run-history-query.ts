import type Database from '../../sqlite/sync-database'
import type {
  WorkflowRunHistoryFilter,
  WorkflowRunSummary
} from '../../../shared/workflow-definition-types'
import {
  exposeTimestamp,
  parseStoredWorkflowDefinition,
  type WorkflowRunRow
} from './workflow-store-records'
import {
  isWorkflowDefinitionV1,
  isWorkflowRunSnapshotV2
} from '../../../shared/workflow-definition-access'
import { workflowV2RouteCatalog } from '../../../shared/workflow-v2-route-catalog'

export function listWorkflowRunHistory(
  db: Database.Database,
  filter: WorkflowRunHistoryFilter,
  callerIdentity: string,
  options?: { schemaVersion?: 2 }
): WorkflowRunSummary[] {
  const clauses = ['owner_identity = ?']
  const values: Database.BindValue[] = [callerIdentity]
  if (options?.schemaVersion === 2) {
    clauses.push("json_extract(template_snapshot_json, '$.schemaVersion') = 2")
  }
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
  const v2Extensions = listV2BudgetExtensions(
    db,
    rows.map((row) => row.id)
  )
  return rows.map((row) => toWorkflowRunSummary(row, v2Extensions.get(row.id) ?? {}))
}

function toWorkflowRunSummary(
  row: WorkflowRunRow,
  v2Extensions: Record<string, number>
): WorkflowRunSummary {
  const rootRunId = row.root_run_id?.trim() || row.id
  const policy = parseJsonObject(row.policy_overrides_json)
  const prompts = parseJsonObject(row.prompt_overrides_json)
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
    policyOverrideVersion:
      policy.policyVersion === 'v1-review-rounds' || policy.policyVersion === 'v2-route-traversals'
        ? policy.policyVersion
        : null,
    promptOverrideNodeIds: Object.keys(prompts),
    failureCode: row.failure_code,
    businessBudgetSummary: businessBudgetSummary(row, v2Extensions),
    startedAt: exposeTimestamp(row.started_at),
    completedAt: exposeTimestamp(row.completed_at),
    createdAt: exposeTimestamp(row.created_at)!,
    updatedAt: exposeTimestamp(row.updated_at)!
  }
}

function businessBudgetSummary(
  row: WorkflowRunRow,
  v2Extensions: Record<string, number>
): string | null {
  const definition = parseStoredWorkflowDefinition(JSON.parse(row.template_snapshot_json))
  const policy = parseJsonObject(row.policy_overrides_json)
  if (isWorkflowDefinitionV1(definition)) {
    const overrides = numberRecord(policy.maxReviewRoundsByNodeId)
    const extensions = numberRecord(parseJsonObject(row.review_round_extensions_json))
    const used = numberRecord(parseJsonObject(row.review_rounds_json))
    const entries = definition.nodes
      .filter((node) => node.type === 'review')
      .map((node) => {
        const template = node.reviewPolicy.maxReviewRounds
        const override = overrides[node.id]
        const extension = extensions[node.id] ?? 0
        return `${node.id}: ${used[node.id] ?? 0}/${(override ?? template) + extension} (template ${template}, override ${override ?? 'none'}, +${extension})`
      })
    return entries.join(' · ') || null
  }
  if (isWorkflowRunSnapshotV2(definition)) {
    const overrides = numberRecord(policy.maxTraversalsByRouteId)
    const baseline = parseJsonObject(row.baseline_json)
    const used = numberRecord(baseline.v2RouteTraversals)
    const entries = workflowV2RouteCatalog(definition).flatMap((route) => {
      const template = route.route.maxTraversals
      const override = overrides[route.id]
      const extension = v2Extensions[route.id] ?? 0
      const base = override ?? template
      return base === undefined && extension === 0
        ? []
        : [
            `${route.id}: ${used[route.id] ?? 0}/${(base ?? 0) + extension} (template ${template ?? 'none'}, override ${override ?? 'none'}, +${extension})`
          ]
    })
    return entries.join(' · ') || null
  }
  return null
}

function listV2BudgetExtensions(
  db: Database.Database,
  runIds: string[]
): Map<string, Record<string, number>> {
  const result = new Map<string, Record<string, number>>()
  if (runIds.length === 0) {
    return result
  }
  const rows = db
    .prepare(
      `SELECT run_id, route_id, SUM(amount) AS amount
       FROM workflow_v2_route_budget_extensions
       WHERE run_id IN (${runIds.map(() => '?').join(', ')})
       GROUP BY run_id, route_id`
    )
    .all(...runIds) as { run_id: string; route_id: string; amount: number }[]
  for (const row of rows) {
    const run = result.get(row.run_id) ?? {}
    run[row.route_id] = row.amount
    result.set(row.run_id, run)
  }
  return result
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'number' && Number.isFinite(entry) ? [[key, entry]] : []
    )
  )
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
