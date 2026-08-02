import { randomBytes } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import type {
  WorkflowAgentAssignment,
  WorkflowPreflightResult,
  WorkflowRunHistoryFilter,
  WorkflowRunRecord,
  WorkflowRunSummary,
  WorkflowWorkspaceRef
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { buildWorkflowPreflightChecks } from './workflow-preflight'
import type { WorkflowAgentUnavailableReason } from './workflow-agent-assignment-availability'
import type { WorkflowTemplateStore } from './workflow-template-store'
import {
  toWorkflowRunRecord,
  type WorkflowAssignmentRow,
  type WorkflowRunRow
} from './workflow-store-records'
import { listWorkflowRunHistory } from './workflow-run-history-query'
import { insertWorkflowEvent } from './workflow-event-store'
import {
  assertWorkflowAgentUnassigned,
  assertWorkflowAssignmentContext,
  assertWorkflowSlotCapacity,
  removeWorkflowSlotAssignments,
  upsertWorkflowAssignment
} from './workflow-run-assignment-store'
import { assertWorkflowRunConfigurable } from './workflow-run-configuration-guard'
import { createWorkflowRunRerun } from './workflow-run-rerun'
import { switchWorkflowRunTemplate } from './workflow-run-template-switch'

export class WorkflowRunStore {
  constructor(
    private readonly db: Database.Database,
    private readonly templates: WorkflowTemplateStore
  ) {}

  create(
    params: {
      templateId: string
      projectIdentity: string
      workspace: WorkflowWorkspaceRef
      executionHostId: string
    },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.db, mutation, () => {
      const template = this.templates.show({
        templateId: params.templateId,
        callerIdentity: mutation.callerIdentity,
        projectIdentity: params.projectIdentity
      })
      if (template.archivedAt) {
        throw new WorkflowError('workflow_archived', 'Archived templates cannot create runs.')
      }
      const id = `workflow_run_${randomBytes(9).toString('hex')}`
      this.db
        .prepare(
          `INSERT INTO workflow_runs (
             id, template_id, template_version, template_name, template_snapshot_json,
             owner_identity, project_identity, workspace_kind, workspace_id, execution_host_id,
             root_run_id, lineage_cycle_base
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          id,
          template.id,
          template.currentVersion,
          template.name,
          JSON.stringify(template.definition),
          mutation.callerIdentity,
          params.projectIdentity,
          params.workspace.kind,
          params.workspace.id,
          params.executionHostId,
          id
        )
      insertWorkflowEvent(this.db, id, 'run-created', null, { status: 'draft' })
      insertWorkflowEvent(this.db, id, 'template-applied', null, {
        templateId: template.id,
        templateVersion: template.currentVersion
      })
      return this.show(id, mutation.callerIdentity)
    })
  }

  createRerun(
    params: Parameters<typeof createWorkflowRunRerun>[2],
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return createWorkflowRunRerun(this.db, this, params, mutation)
  }

  show(runId: string, callerIdentity: string): WorkflowRunRecord {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as
      | WorkflowRunRow
      | undefined
    if (!row) {
      throw new WorkflowError('workflow_not_found', `Workflow run ${runId} was not found.`)
    }
    if (row.owner_identity !== callerIdentity) {
      throw new WorkflowError('workflow_forbidden', 'Workflow run belongs to another owner.')
    }
    const assignments = this.db
      .prepare(
        `SELECT node_id, slot_id, worktree_id, execution_host_id, pane_key,
                agent_lifecycle_id, provider_session_id, runtime_agent
         FROM workflow_agent_assignments WHERE run_id = ?
         ORDER BY node_id, slot_id, agent_lifecycle_id`
      )
      .all(runId) as WorkflowAssignmentRow[]
    return toWorkflowRunRecord(row, assignments)
  }

  list(filter: WorkflowRunHistoryFilter, callerIdentity: string): WorkflowRunSummary[] {
    return listWorkflowRunHistory(this.db, filter, callerIdentity)
  }

  updateObjective(
    params: { runId: string; objective: string },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.db, mutation, () => {
      const run = this.show(params.runId, mutation.callerIdentity)
      assertWorkflowRunConfigurable(run)
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET objective = ?, status = 'draft', version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(params.objective, run.id, run.version)
      return this.show(run.id, mutation.callerIdentity)
    })
  }

  switchTemplate(
    params: { runId: string; templateId: string; expectedVersion: number },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return switchWorkflowRunTemplate(this.db, this, this.templates, params, mutation)
  }

  assign(
    params: {
      runId: string
      nodeId: string
      slotId: string
      assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> | null
      removeAgentLifecycleId?: string
    },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.db, mutation, () => {
      const run = this.show(params.runId, mutation.callerIdentity)
      assertWorkflowRunConfigurable(run)
      const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === params.nodeId)
      const slot = run.templateSnapshot.roleSlots.find(
        (candidate) => candidate.id === params.slotId
      )
      if (!node?.roleSlotIds.includes(params.slotId) || !slot) {
        throw new WorkflowError(
          'workflow_context_mismatch',
          'Role slot does not belong to the node.'
        )
      }
      if (params.assignment === null) {
        removeWorkflowSlotAssignments(this.db, {
          runId: run.id,
          nodeId: params.nodeId,
          slotId: params.slotId,
          agentLifecycleId: params.removeAgentLifecycleId
        })
      } else {
        assertWorkflowAssignmentContext(run, params.assignment)
        assertWorkflowAgentUnassigned(this.db, {
          runId: run.id,
          nodeId: params.nodeId,
          slotId: params.slotId,
          agentLifecycleId: params.assignment.agentLifecycleId
        })
        if (slot.maxAgents === 1) {
          removeWorkflowSlotAssignments(this.db, {
            runId: run.id,
            nodeId: params.nodeId,
            slotId: params.slotId
          })
        } else {
          assertWorkflowSlotCapacity(this.db, {
            runId: run.id,
            nodeId: params.nodeId,
            slotId: params.slotId,
            maxAgents: slot.maxAgents,
            agentLifecycleId: params.assignment.agentLifecycleId
          })
        }
        upsertWorkflowAssignment(this.db, {
          runId: run.id,
          nodeId: params.nodeId,
          slotId: params.slotId,
          assignment: params.assignment
        })
        insertWorkflowEvent(this.db, run.id, 'agent-assigned', null, {
          nodeId: params.nodeId,
          slotId: params.slotId,
          agentLifecycleId: params.assignment.agentLifecycleId
        })
      }
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'draft', version = version + 1, updated_at = datetime('now') WHERE id = ?`
        )
        .run(run.id)
      return this.show(run.id, mutation.callerIdentity)
    })
  }

  prepare(
    params: {
      runId: string
      workspaceAvailable: boolean
      capabilityAvailable: boolean
      unavailableAgentLifecycleIds: string[]
      unavailableAgentReasons?: Record<string, WorkflowAgentUnavailableReason>
    },
    mutation: WorkflowMutation
  ): WorkflowPreflightResult {
    return runWorkflowMutation(this.db, mutation, () => {
      const run = this.show(params.runId, mutation.callerIdentity)
      assertWorkflowRunConfigurable(run)
      const checks = buildWorkflowPreflightChecks(run, params)
      const ready = checks.every((check) => check.status === 'passed')
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET status = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
        )
        .run(ready ? 'ready' : 'draft', run.id)
      return { ready, checks, run: this.show(run.id, mutation.callerIdentity) }
    })
  }
}
