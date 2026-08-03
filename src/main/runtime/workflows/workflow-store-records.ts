import { parseWorkflowDefinitionV1 } from '../../../shared/workflow-definition-schema'
import { parseWorkflowDefinitionV2 } from '../../../shared/workflow-definition-v2-schema'
import type {
  WorkflowArtifactRevision,
  WorkflowStepRunRecord,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowResolutionContext,
  WorkflowTemplateRecord,
  WorkflowTemplateScope,
  WorkflowTemplateSnapshot,
  WorkflowWorkspaceRef
} from '../../../shared/workflow-definition-types'
import {
  parseWorkflowRunPolicyOverrides,
  parseWorkflowRunPromptOverrides
} from '../../../shared/workflow-run-lineage'
import { WorkflowError } from './workflow-error'

export type WorkflowTemplateRow = {
  id: string
  name: string
  scope: WorkflowTemplateScope
  owner_identity: string
  project_identity: string | null
  archived_at: string | null
  archived_by: string | null
  current_version: number
  definition_json: string
  created_at: string
  updated_at: string
}

export type WorkflowRunRow = {
  id: string
  status: WorkflowRunStatus
  version: number
  template_id: string
  template_version: number
  template_name: string
  template_snapshot_json: string
  owner_identity: string
  project_identity: string
  workspace_kind: WorkflowWorkspaceRef['kind']
  workspace_id: string
  execution_host_id: string
  objective: string
  current_node_id: string | null
  orchestration_run_id: string | null
  waiting_reason: WorkflowRunRecord['waitingReason']
  resolution_context_json: string | null
  review_rounds_json: string
  review_round_extensions_json: string
  parent_run_id: string | null
  root_run_id: string | null
  lineage_cycle_base: number | null
  rerun_reason: string | null
  no_additional_requirements: number | null
  policy_overrides_json: string | null
  prompt_overrides_json: string | null
  baseline_json: string | null
  failure_code: string | null
  failure_message: string | null
  recovery: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type WorkflowAssignmentRow = {
  node_id: string
  slot_id: string
  worktree_id: string
  execution_host_id: string
  pane_key: string
  agent_lifecycle_id: string
  provider_session_id: string | null
  runtime_agent: string | null
}

export function parseStoredWorkflowDefinition(value: unknown): WorkflowTemplateSnapshot {
  try {
    if (
      value &&
      typeof value === 'object' &&
      (value as { schemaVersion?: unknown }).schemaVersion === 2
    ) {
      return parseWorkflowDefinitionV2(value)
    }
    return parseWorkflowDefinitionV1(value)
  } catch (error) {
    throw new WorkflowError('workflow_definition_invalid', 'Workflow definition is invalid.', error)
  }
}

export function toWorkflowTemplateRecord(row: WorkflowTemplateRow): WorkflowTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    ownerIdentity: row.owner_identity,
    projectIdentity: row.project_identity,
    archivedAt: exposeTimestamp(row.archived_at),
    archivedBy: row.archived_by,
    currentVersion: row.current_version,
    definition: parseStoredWorkflowDefinition(JSON.parse(row.definition_json)),
    createdAt: exposeTimestamp(row.created_at)!,
    updatedAt: exposeTimestamp(row.updated_at)!
  }
}

export function toWorkflowRunRecord(
  row: WorkflowRunRow,
  assignmentRows: WorkflowAssignmentRow[],
  steps: WorkflowStepRunRecord[] = [],
  artifacts: WorkflowArtifactRevision[] = []
): WorkflowRunRecord {
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    templateId: row.template_id,
    templateVersion: row.template_version,
    templateName: row.template_name,
    templateSnapshot: parseStoredWorkflowDefinition(
      JSON.parse(row.template_snapshot_json)
    ) as WorkflowRunRecord['templateSnapshot'],
    ownerIdentity: row.owner_identity,
    projectIdentity: row.project_identity,
    workspace: { kind: row.workspace_kind, id: row.workspace_id },
    executionHostId: row.execution_host_id,
    objective: row.objective,
    assignments: assignmentRows.map((assignment) => ({
      nodeId: assignment.node_id,
      slotId: assignment.slot_id,
      worktreeId: assignment.worktree_id,
      executionHostId: assignment.execution_host_id,
      paneKey: assignment.pane_key,
      agentLifecycleId: assignment.agent_lifecycle_id,
      providerSessionId: assignment.provider_session_id,
      runtimeAgent: assignment.runtime_agent
    })),
    currentNodeId: row.current_node_id,
    orchestrationRunId: row.orchestration_run_id,
    waitingReason: row.waiting_reason,
    resolutionContext: row.resolution_context_json
      ? (JSON.parse(row.resolution_context_json) as WorkflowResolutionContext)
      : null,
    resolutionOffers: [],
    reviewRoundsByNodeId: JSON.parse(row.review_rounds_json) as Record<string, number>,
    reviewRoundExtensionsByNodeId: JSON.parse(row.review_round_extensions_json) as Record<
      string,
      number
    >,
    parentRunId: row.parent_run_id ?? null,
    rootRunId: row.root_run_id?.trim() || row.id,
    lineageCycleBase: row.lineage_cycle_base ?? 0,
    rerunReason: row.rerun_reason ?? null,
    noAdditionalRequirements: Boolean(row.no_additional_requirements),
    policyOverrides: parseWorkflowRunPolicyOverrides(
      row.policy_overrides_json ? JSON.parse(row.policy_overrides_json) : null
    ),
    promptOverrides: parseWorkflowRunPromptOverrides(
      row.prompt_overrides_json ? JSON.parse(row.prompt_overrides_json) : null
    ),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    recovery: row.recovery,
    startedAt: exposeTimestamp(row.started_at),
    completedAt: exposeTimestamp(row.completed_at),
    steps,
    artifacts,
    reviewAggregates: [],
    decisions: [],
    createdAt: exposeTimestamp(row.created_at)!,
    updatedAt: exposeTimestamp(row.updated_at)!
  }
}

export function exposeTimestamp(value: string | null): string | null {
  return value && !value.includes('T') ? `${value.replace(' ', 'T')}Z` : value
}
