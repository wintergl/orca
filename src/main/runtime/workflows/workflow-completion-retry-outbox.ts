import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowCompletionReconciliationRecord } from './workflow-completion-reconciliation-store'
import {
  claimWorkflowDispatchOwnership,
  terminalizeWorkflowDispatchOwnership
} from './workflow-dispatch-ownership-store'
import type Database from '../../sqlite/sync-database'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { workflowRecordId } from './workflow-runtime-records'
import type { WorkflowStore } from './workflow-store'
import { tryConsumeV2RetryOutbox } from './workflow-completion-retry-outbox-v2'
import { requireWorkflowDefinitionV1 } from '../../../shared/workflow-definition-access'

/** Hosts that expose a Workflow DB without a private `db` field clash. */
export type WorkflowMutationHost = {
  transaction<T>(operation: () => T): T
  getStep(stepRunId: string): WorkflowStepRunRecord | null
  insertStep: WorkflowRuntimePersistence['insertStep']
  insertEvent: WorkflowRuntimePersistence['insertEvent']
  persistenceDb: Database.Database
}

/**
 * Atomically consume retry outbox inside a new Workflow DB transaction.
 */
export function consumeWorkflowRetryOutbox(
  store: WorkflowMutationHost,
  run: WorkflowRunRecord,
  record: WorkflowCompletionReconciliationRecord
): WorkflowStepRunRecord | null {
  if (record.retryOutboxState !== 'pending' || record.state !== 'settled') {
    if (record.retryStepRunId) {
      return store.getStep(record.retryStepRunId)
    }
    return null
  }
  return store.transaction(() => consumeWorkflowRetryOutboxInTransaction(store, run, record))
}

export function consumeWorkflowRetryOutboxInTransaction(
  store: WorkflowMutationHost,
  run: WorkflowRunRecord,
  record: WorkflowCompletionReconciliationRecord
): WorkflowStepRunRecord | null {
  const db = store.persistenceDb
  const current = db
    .prepare(
      `SELECT retry_outbox_state, retry_step_run_id FROM workflow_completion_reconciliations
       WHERE receipt_id = ?`
    )
    .get(record.receiptId) as
    | { retry_outbox_state: string; retry_step_run_id: string | null }
    | undefined
  if (!current) {
    return null
  }
  if (current.retry_outbox_state === 'consumed' && current.retry_step_run_id) {
    return store.getStep(current.retry_step_run_id)
  }
  if (current.retry_outbox_state !== 'pending') {
    return null
  }
  const failed = store.getStep(record.stepRunId)
  if (!failed?.assignment) {
    db.prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', updated_at = datetime('now')
       WHERE receipt_id = ? AND retry_outbox_state = 'pending'`
    ).run(record.receiptId)
    return null
  }
  const v2Retry = tryConsumeV2RetryOutbox(store, db, run, failed, record.receiptId)
  if (v2Retry !== undefined) {
    return v2Retry
  }
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 retry outbox')
  const node = definition.nodes.find((candidate) => candidate.id === failed.nodeId)
  if (!node || (node.type !== 'decide' && node.type !== 'review')) {
    db.prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', updated_at = datetime('now')
       WHERE receipt_id = ? AND retry_outbox_state = 'pending'`
    ).run(record.receiptId)
    return null
  }
  const retry = store.insertStep(
    run.id,
    node,
    failed.assignment,
    failed.inputArtifactRevisionId,
    'queued',
    failed.round,
    failed.attempt + 1
  )
  const claimed = db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', retry_step_run_id = ?, updated_at = datetime('now')
       WHERE receipt_id = ? AND state = 'settled' AND retry_outbox_state = 'pending'`
    )
    .run(retry.id, record.receiptId)
  if (claimed.changes !== 1) {
    db.prepare('DELETE FROM workflow_step_runs WHERE id = ?').run(retry.id)
    const winner = db
      .prepare(
        `SELECT retry_step_run_id FROM workflow_completion_reconciliations WHERE receipt_id = ?`
      )
      .get(record.receiptId) as { retry_step_run_id: string | null } | undefined
    return winner?.retry_step_run_id ? store.getStep(winner.retry_step_run_id) : null
  }
  store.insertEvent(run.id, node.type === 'review' ? 'review-fan-out' : 'step-retried', retry.id, {
    retryOfStepRunId: failed.id,
    attempt: retry.attempt,
    receiptId: record.receiptId
  })
  return retry
}

export function terminalizeWorkflowStepOwnership(
  store: WorkflowStore | WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): boolean {
  const assignmentKey = step.assignment
    ? `${step.assignment.slotId}:${step.assignment.agentLifecycleId}`
    : 'engine'
  const db = 'persistenceDb' in store ? store.persistenceDb : store.db
  return terminalizeWorkflowDispatchOwnership(db, {
    runId: run.id,
    nodeId: step.nodeId,
    round: step.round,
    assignmentKey,
    stepRunId: step.id
  })
}

/**
 * Standalone entry (starts its own transaction).
 * Prefer InTransaction when already inside runWorkflowMutation.
 */
export function retryWorkflowStepWithDuplicateRisk(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  stepRunId: string,
  reason: string | null
): WorkflowStepRunRecord {
  return store.transaction(() =>
    retryWorkflowStepWithDuplicateRiskInTransaction(store, run, stepRunId, reason)
  )
}

/**
 * Fence old owner and create successor attempt. Caller must hold the Workflow TX.
 */
export function retryWorkflowStepWithDuplicateRiskInTransaction(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  stepRunId: string,
  reason: string | null
): WorkflowStepRunRecord {
  const step = store.getStep(stepRunId)
  if (!step) {
    throw new WorkflowError('workflow_action_forbidden', 'Step is not eligible for risk retry.')
  }
  if (
    ![
      'running',
      'delivering',
      'waiting-agent',
      'failed',
      'timed-out',
      'completion-incomplete'
    ].includes(step.status)
  ) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Step is not eligible for risk retry in its current status.'
    )
  }
  const assignmentKey = step.assignment
    ? `${step.assignment.slotId}:${step.assignment.agentLifecycleId}`
    : 'engine'
  terminalizeWorkflowDispatchOwnership(store.db, {
    runId: run.id,
    nodeId: step.nodeId,
    round: step.round,
    assignmentKey,
    stepRunId: step.id
  })
  if (['running', 'delivering', 'waiting-agent'].includes(step.status)) {
    store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'failed', error_code = 'workflow_delivery_uncertain',
             error_message = ?, recovery = 'Duplicate-risk retry accepted by operator.',
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND status IN ('running', 'delivering', 'waiting-agent')`
      )
      .run(reason?.trim() || 'Operator accepted duplicate-risk retry.', step.id)
  }
  store.db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET state = 'settled', retry_outbox_state = CASE
           WHEN retry_outbox_state = 'pending' THEN 'consumed' ELSE retry_outbox_state END,
           updated_at = datetime('now')
       WHERE run_id = ? AND step_run_id = ? AND attempt = ? AND state != 'settled'`
    )
    .run(run.id, step.id, step.attempt)
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 duplicate-risk retry')
  const node = definition.nodes.find((candidate) => candidate.id === step.nodeId)
  if (!node) {
    throw new WorkflowError('workflow_transition_invalid', 'Retry node is unavailable.')
  }
  const retry = store.insertStep(
    run.id,
    node,
    step.assignment,
    step.inputArtifactRevisionId,
    'queued',
    step.round,
    step.attempt + 1
  )
  const ownership = claimWorkflowDispatchOwnership(store.db, {
    runId: run.id,
    nodeId: retry.nodeId,
    round: retry.round,
    assignmentKey,
    stepRunId: retry.id,
    attempt: retry.attempt,
    taskId: null,
    dispatchId: null
  })
  if (!ownership.claimed) {
    throw new WorkflowError(
      'workflow_delivery_uncertain',
      'Could not claim ownership for duplicate-risk retry.'
    )
  }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'running', current_node_id = ?, waiting_reason = NULL,
           resolution_context_json = NULL, failure_code = NULL, failure_message = NULL,
           recovery = NULL, completed_at = NULL, version = version + 1,
           updated_at = datetime('now') WHERE id = ?`
    )
    .run(step.nodeId, run.id)
  store.insertEvent(run.id, 'step-retried', retry.id, {
    retryOfStepRunId: step.id,
    attempt: retry.attempt,
    round: retry.round,
    reason,
    duplicateRiskAccepted: true,
    fenceId: workflowRecordId('workflow_fence')
  })
  return retry
}

export function classifyWorkflowStepFailureCode(error: unknown, message: string): string {
  if (error instanceof WorkflowError) {
    return error.code
  }
  if (message.includes('workflow_delivery_uncertain') || message.includes('delivery-uncertain')) {
    return 'workflow_delivery_uncertain'
  }
  if (message.includes('lifecycle-mismatch') || message.includes('workflow_lifecycle_mismatch')) {
    return 'workflow_lifecycle_mismatch'
  }
  return 'workflow_agent_unavailable'
}

export function isHumanWaitFailureCode(code: string): boolean {
  return (
    code === 'workflow_delivery_uncertain' ||
    code === 'workflow_lifecycle_mismatch' ||
    code === 'workflow_transport_disconnected'
  )
}

export function recoveryMessageForFailureCode(code: string): string {
  switch (code) {
    case 'workflow_delivery_uncertain':
      return 'Inspect the Dispatch before choosing any duplicate-risk retry.'
    case 'workflow_lifecycle_mismatch':
      return 'Inspect Agent lifecycle ownership before retrying or reassigning.'
    case 'workflow_artifact_drifted':
      return 'Regenerate the Artifact Revision before another Review.'
    case 'workflow_artifact_unavailable':
      return 'Fix the Artifact path or snapshot limit, then create a new Run.'
    case 'workflow_completion_incomplete':
      return 'Open the Step evidence and provide a complete bound result envelope.'
    default:
      return 'Retry this Step if the original Agent identity is still valid; otherwise reassign an idle Agent.'
  }
}
