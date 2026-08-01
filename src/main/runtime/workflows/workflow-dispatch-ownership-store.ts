import type Database from '../../sqlite/sync-database'

export type WorkflowDispatchOwnershipState = 'active' | 'terminal'

export type WorkflowDispatchOwnershipRecord = {
  logicalExecutionKey: string
  runId: string
  nodeId: string
  round: number
  assignmentKey: string
  stepRunId: string
  attempt: number
  taskId: string | null
  dispatchId: string | null
  state: WorkflowDispatchOwnershipState
}

/** V1: runId + nodeId + round + assignmentKey */
export function buildWorkflowLogicalExecutionKey(params: {
  runId: string
  nodeId: string
  round: number
  assignmentKey: string
}): string {
  return `${params.runId}\u0000${params.nodeId}\u0000${params.round}\u0000${params.assignmentKey}`
}

export function claimWorkflowDispatchOwnership(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    round: number
    assignmentKey: string
    stepRunId: string
    attempt: number
    taskId: string | null
    dispatchId: string | null
  }
): { claimed: boolean; record: WorkflowDispatchOwnershipRecord | null } {
  const key = buildWorkflowLogicalExecutionKey(params)
  const existing = getOwnership(db, key)
  if (existing?.state === 'active') {
    if (existing.stepRunId === params.stepRunId && existing.attempt === params.attempt) {
      return { claimed: true, record: existing }
    }
    return { claimed: false, record: existing }
  }
  if (!existing) {
    db.prepare(
      `INSERT INTO workflow_dispatch_ownership (
         logical_execution_key, run_id, node_id, round, assignment_key,
         step_run_id, attempt, task_id, dispatch_id, state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      key,
      params.runId,
      params.nodeId,
      params.round,
      params.assignmentKey,
      params.stepRunId,
      params.attempt,
      params.taskId,
      params.dispatchId
    )
    return { claimed: true, record: getOwnership(db, key) }
  }
  // CAS: only terminal ownership may flip to a new active attempt.
  const result = db
    .prepare(
      `UPDATE workflow_dispatch_ownership
       SET step_run_id = ?, attempt = ?, task_id = ?, dispatch_id = ?,
           state = 'active', updated_at = datetime('now')
       WHERE logical_execution_key = ? AND state = 'terminal'`
    )
    .run(params.stepRunId, params.attempt, params.taskId, params.dispatchId, key)
  if (result.changes !== 1) {
    return { claimed: false, record: getOwnership(db, key) }
  }
  return { claimed: true, record: getOwnership(db, key) }
}

export function bindWorkflowDispatchOwnershipIds(
  db: Database.Database,
  params: {
    logicalExecutionKey: string
    stepRunId: string
    taskId: string
    dispatchId: string
  }
): boolean {
  const result = db
    .prepare(
      `UPDATE workflow_dispatch_ownership
       SET task_id = ?, dispatch_id = ?, updated_at = datetime('now')
       WHERE logical_execution_key = ? AND step_run_id = ? AND state = 'active'`
    )
    .run(params.taskId, params.dispatchId, params.logicalExecutionKey, params.stepRunId)
  return result.changes === 1
}

export function terminalizeWorkflowDispatchOwnership(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    round: number
    assignmentKey: string
    stepRunId: string
  }
): boolean {
  const key = buildWorkflowLogicalExecutionKey(params)
  const result = db
    .prepare(
      `UPDATE workflow_dispatch_ownership
       SET state = 'terminal', updated_at = datetime('now')
       WHERE logical_execution_key = ? AND step_run_id = ? AND state = 'active'`
    )
    .run(key, params.stepRunId)
  return result.changes === 1
}

export function getWorkflowDispatchOwnership(
  db: Database.Database,
  params: {
    runId: string
    nodeId: string
    round: number
    assignmentKey: string
  }
): WorkflowDispatchOwnershipRecord | null {
  return getOwnership(db, buildWorkflowLogicalExecutionKey(params))
}

function getOwnership(db: Database.Database, key: string): WorkflowDispatchOwnershipRecord | null {
  const row = db
    .prepare('SELECT * FROM workflow_dispatch_ownership WHERE logical_execution_key = ?')
    .get(key) as
    | {
        logical_execution_key: string
        run_id: string
        node_id: string
        round: number
        assignment_key: string
        step_run_id: string
        attempt: number
        task_id: string | null
        dispatch_id: string | null
        state: WorkflowDispatchOwnershipState
      }
    | undefined
  if (!row) {
    return null
  }
  return {
    logicalExecutionKey: row.logical_execution_key,
    runId: row.run_id,
    nodeId: row.node_id,
    round: row.round,
    assignmentKey: row.assignment_key,
    stepRunId: row.step_run_id,
    attempt: row.attempt,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    state: row.state
  }
}
