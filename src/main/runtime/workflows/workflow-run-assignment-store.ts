import type Database from '../../sqlite/sync-database'
import type {
  WorkflowAgentAssignment,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'

type AssignmentIdentity = Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>

export function removeWorkflowSlotAssignments(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    slotId: string
    agentLifecycleId?: string
  }
): void {
  if (params.agentLifecycleId) {
    db.prepare(
      `DELETE FROM workflow_agent_assignments
       WHERE run_id = ? AND node_id = ? AND slot_id = ? AND agent_lifecycle_id = ?`
    ).run(params.runId, params.nodeId, params.slotId, params.agentLifecycleId)
    return
  }
  db.prepare(
    'DELETE FROM workflow_agent_assignments WHERE run_id = ? AND node_id = ? AND slot_id = ?'
  ).run(params.runId, params.nodeId, params.slotId)
}

export function assertWorkflowSlotCapacity(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    slotId: string
    maxAgents: number
    agentLifecycleId: string
  }
): void {
  const row = db
    .prepare(
      `SELECT count(*) AS count FROM workflow_agent_assignments
       WHERE run_id = ? AND node_id = ? AND slot_id = ? AND agent_lifecycle_id <> ?`
    )
    .get(params.runId, params.nodeId, params.slotId, params.agentLifecycleId) as { count: number }
  if (row.count >= params.maxAgents) {
    throw new WorkflowError('workflow_context_mismatch', 'Role slot is already full.')
  }
}

export function assertWorkflowAgentUnassigned(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    slotId: string
    agentLifecycleId: string
  }
): void {
  const row = db
    .prepare(
      `SELECT node_id, slot_id FROM workflow_agent_assignments
       WHERE run_id = ? AND agent_lifecycle_id = ?
         AND (node_id <> ? OR slot_id <> ?) LIMIT 1`
    )
    .get(params.runId, params.agentLifecycleId, params.nodeId, params.slotId) as
    | { node_id: string; slot_id: string }
    | undefined
  if (row) {
    throw new WorkflowError(
      'workflow_context_mismatch',
      'An Agent can hold only one immediate Workflow role.'
    )
  }
}

export function upsertWorkflowAssignment(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    slotId: string
    assignment: AssignmentIdentity
  }
): void {
  const assignment = params.assignment
  db.prepare(
    `INSERT INTO workflow_agent_assignments (
       run_id, node_id, slot_id, worktree_id, execution_host_id, pane_key,
       agent_lifecycle_id, provider_session_id, runtime_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, node_id, slot_id, agent_lifecycle_id) DO UPDATE SET
       worktree_id = excluded.worktree_id,
       execution_host_id = excluded.execution_host_id,
       pane_key = excluded.pane_key,
       provider_session_id = excluded.provider_session_id,
       runtime_agent = excluded.runtime_agent`
  ).run(
    params.runId,
    params.nodeId,
    params.slotId,
    assignment.worktreeId,
    assignment.executionHostId,
    assignment.paneKey,
    assignment.agentLifecycleId,
    assignment.providerSessionId,
    assignment.runtimeAgent
  )
}

export function assertWorkflowAssignmentContext(
  run: WorkflowRunRecord,
  assignment: AssignmentIdentity
): void {
  if (
    assignment.worktreeId !== run.workspace.id ||
    assignment.executionHostId !== run.executionHostId
  ) {
    throw new WorkflowError(
      'workflow_context_mismatch',
      'Agent workspace or execution host does not match the run.'
    )
  }
  if (!assignment.paneKey || !assignment.agentLifecycleId) {
    throw new WorkflowError(
      'workflow_agent_unavailable',
      'Agent identity is incomplete and cannot be assigned.'
    )
  }
}
