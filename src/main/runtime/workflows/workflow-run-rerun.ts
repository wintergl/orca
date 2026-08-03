import { randomBytes } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import type {
  WorkflowAgentAssignment,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import {
  assertRerunRequirements,
  parseWorkflowRunPolicyOverrides,
  parseWorkflowRunPromptOverrides,
  type WorkflowRunPolicyOverrides,
  type WorkflowRunPromptOverrides
} from '../../../shared/workflow-run-lineage'
import { WorkflowError } from './workflow-error'
import { insertWorkflowEvent } from './workflow-event-store'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { upsertWorkflowAssignment } from './workflow-run-assignment-store'
import type { WorkflowRunStore } from './workflow-run-store'

export function createWorkflowRunRerun(
  db: Database.Database,
  runs: WorkflowRunStore,
  params: {
    parentRunId: string
    rerunReason?: string | null
    noAdditionalRequirements?: boolean
    objective?: string
    policyOverrides?: WorkflowRunPolicyOverrides | null
    promptOverrides?: WorkflowRunPromptOverrides | null
    copyAssignments?: boolean
  },
  mutation: WorkflowMutation
): WorkflowRunRecord {
  return runWorkflowMutation(db, mutation, () => {
    const parent = runs.show(params.parentRunId, mutation.callerIdentity)
    if (parent.status !== 'completed') {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Only completed runs can start another round.'
      )
    }
    try {
      assertRerunRequirements({
        rerunReason: params.rerunReason,
        noAdditionalRequirements: Boolean(params.noAdditionalRequirements)
      })
    } catch (error) {
      throw new WorkflowError(
        'workflow_context_mismatch',
        error instanceof Error ? error.message : String(error)
      )
    }
    const policyOverrides =
      params.policyOverrides === undefined
        ? parent.policyOverrides
        : parseWorkflowRunPolicyOverrides(params.policyOverrides)
    const promptOverrides =
      params.promptOverrides === undefined
        ? parent.promptOverrides
        : parseWorkflowRunPromptOverrides(params.promptOverrides)
    // Why: runs.show() omits steps; lineageCycle = parentBase + parentLocalMaxRound.
    const parentMaxRound = db
      .prepare(
        `SELECT COALESCE(MAX(round), 0) AS max_round FROM workflow_step_runs WHERE run_id = ?`
      )
      .get(parent.id) as { max_round: number }
    const lineageCycleBase =
      Math.max(0, parent.lineageCycleBase) + Math.max(0, parentMaxRound.max_round)
    const id = `workflow_run_${randomBytes(9).toString('hex')}`
    const objective = params.objective?.trim() || parent.objective
    const rootRunId = parent.rootRunId || parent.id
    db.prepare(
      `INSERT INTO workflow_runs (
         id, template_id, template_version, template_name, template_snapshot_json,
         owner_identity, project_identity, workspace_kind, workspace_id, execution_host_id,
         objective, parent_run_id, root_run_id, lineage_cycle_base, rerun_reason,
         no_additional_requirements, policy_overrides_json, prompt_overrides_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      parent.templateId,
      parent.templateVersion,
      parent.templateName,
      JSON.stringify(parent.templateSnapshot),
      mutation.callerIdentity,
      parent.projectIdentity,
      parent.workspace.kind,
      parent.workspace.id,
      parent.executionHostId,
      objective,
      parent.id,
      rootRunId,
      lineageCycleBase,
      params.noAdditionalRequirements ? null : (params.rerunReason?.trim() ?? null),
      params.noAdditionalRequirements ? 1 : 0,
      policyOverrides ? JSON.stringify(policyOverrides) : null,
      promptOverrides ? JSON.stringify(promptOverrides) : null
    )
    if (params.copyAssignments !== false) {
      for (const assignment of parent.assignments) {
        upsertWorkflowAssignment(db, {
          runId: id,
          nodeId: assignment.nodeId,
          slotId: assignment.slotId,
          assignment: withoutNodeSlot(assignment)
        })
      }
    }
    insertWorkflowEvent(db, id, 'run-created', null, {
      status: 'draft',
      parentRunId: parent.id,
      rootRunId,
      lineageCycleBase
    })
    insertWorkflowEvent(db, id, 'template-applied', null, {
      templateId: parent.templateId,
      templateVersion: parent.templateVersion,
      source: 'parent-snapshot'
    })
    return runs.show(id, mutation.callerIdentity)
  })
}

function withoutNodeSlot(
  assignment: WorkflowAgentAssignment
): Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> {
  return {
    worktreeId: assignment.worktreeId,
    executionHostId: assignment.executionHostId,
    paneKey: assignment.paneKey,
    agentLifecycleId: assignment.agentLifecycleId,
    providerSessionId: assignment.providerSessionId,
    runtimeAgent: assignment.runtimeAgent
  }
}
