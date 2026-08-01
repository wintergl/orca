import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { WorkflowError } from './workflow-error'
import { workflowDigest, workflowRecordId } from './workflow-runtime-records'

/** Persist external Task/Dispatch identity as soon as Orchestration creates them. */
export function bindWorkflowStepDispatchIdentity(
  store: WorkflowRuntimePersistence,
  params: {
    runId: string
    stepRunId: string
    taskId: string
    dispatchId: string
  }
): void {
  store.transaction(() => {
    store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET task_id = ?, dispatch_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(params.taskId, params.dispatchId, params.stepRunId)
    const step = store.getStep(params.stepRunId)
    if (!step) {
      return
    }
    store.db
      .prepare(
        `INSERT INTO workflow_deliveries (
           id, run_id, step_run_id, attempt, delivery_kind, status, task_id, dispatch_id
         ) VALUES (?, ?, ?, ?, 'prompt', 'prepared', ?, ?)
         ON CONFLICT(run_id, step_run_id, attempt, delivery_kind) DO UPDATE SET
           task_id = excluded.task_id, dispatch_id = excluded.dispatch_id,
           updated_at = datetime('now')`
      )
      .run(
        step.deliveryId,
        params.runId,
        params.stepRunId,
        step.attempt,
        params.taskId,
        params.dispatchId
      )
  })
}

export function markWorkflowStepDelivering(
  store: WorkflowRuntimePersistence,
  params: {
    runId: string
    stepRunId: string
    taskId: string
    dispatchId: string
    prompt: string
  }
): void {
  store.transaction(() => {
    const digest = workflowDigest(params.prompt)
    const updated = store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'delivering', task_id = ?, dispatch_id = ?, prompt = ?,
             delivery_state = 'delivering', updated_at = datetime('now')
         WHERE id = ? AND status IN ('queued', 'waiting-agent')`
      )
      .run(params.taskId, params.dispatchId, params.prompt, params.stepRunId)
    if (updated.changes === 0) {
      const current = store.getStep(params.stepRunId)
      if (
        current?.deliveryState === 'delivering' &&
        current.taskId === params.taskId &&
        current.dispatchId === params.dispatchId
      ) {
        return
      }
      throw new WorkflowError(
        'workflow_transition_invalid',
        'Step is not eligible for prompt delivery.'
      )
    }
    store.db
      .prepare(
        `INSERT INTO workflow_messages (
           id, run_id, step_run_id, kind, markdown, digest
         ) VALUES (?, ?, ?, 'prompt', ?, ?)`
      )
      .run(
        workflowRecordId('workflow_message'),
        params.runId,
        params.stepRunId,
        params.prompt,
        digest
      )
    store.insertEvent(params.runId, 'prompt-delivery-started', params.stepRunId, {
      taskId: params.taskId,
      dispatchId: params.dispatchId
    })
    const step = store.getStep(params.stepRunId)!
    store.db
      .prepare(
        `INSERT INTO workflow_deliveries (
           id, run_id, step_run_id, attempt, delivery_kind, status, task_id, dispatch_id
         ) VALUES (?, ?, ?, ?, 'prompt', 'delivering', ?, ?)
         ON CONFLICT(run_id, step_run_id, attempt, delivery_kind) DO UPDATE SET
           status = 'delivering', task_id = excluded.task_id,
           dispatch_id = excluded.dispatch_id, updated_at = datetime('now')`
      )
      .run(
        step.deliveryId,
        params.runId,
        params.stepRunId,
        step.attempt,
        params.taskId,
        params.dispatchId
      )
  })
}

export function markWorkflowStepDelivered(
  store: WorkflowRuntimePersistence,
  params: {
    runId: string
    stepRunId: string
    receipt: unknown
    reviewGuardDigest?: string
  }
): void {
  store.transaction(() => {
    const updated = store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET review_guard_digest = COALESCE(?, review_guard_digest),
             delivery_state = 'delivered', updated_at = datetime('now')
         WHERE id = ? AND status = 'delivering' AND delivery_state = 'delivering'`
      )
      .run(params.reviewGuardDigest ?? null, params.stepRunId)
    if (updated.changes === 0) {
      const current = store.getStep(params.stepRunId)
      if (current?.deliveryState === 'delivered') {
        return
      }
      throw new WorkflowError(
        'workflow_transition_invalid',
        'Step is not awaiting a delivery receipt.'
      )
    }
    store.db
      .prepare(
        `UPDATE workflow_deliveries
         SET status = 'delivered', receipt_json = ?, updated_at = datetime('now')
         WHERE step_run_id = ? AND delivery_kind = 'prompt'`
      )
      .run(JSON.stringify(params.receipt), params.stepRunId)
    store.insertEvent(params.runId, 'prompt-delivered', params.stepRunId, params.receipt)
  })
}

export function markWorkflowStepWorking(
  store: WorkflowRuntimePersistence,
  params: { runId: string; stepRunId: string; source: 'agent-status-hook' | 'recovery' }
): void {
  store.transaction(() => {
    const updated = store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'running', started_at = COALESCE(started_at, datetime('now')),
             updated_at = datetime('now')
         WHERE id = ? AND status = 'delivering' AND delivery_state = 'delivered'`
      )
      .run(params.stepRunId)
    if (updated.changes === 0) {
      if (store.getStep(params.stepRunId)?.status === 'running') {
        return
      }
      throw new WorkflowError(
        'workflow_transition_invalid',
        'Step is not awaiting an Agent working status.'
      )
    }
    store.insertEvent(params.runId, 'step-working', params.stepRunId, { source: params.source })
  })
}
