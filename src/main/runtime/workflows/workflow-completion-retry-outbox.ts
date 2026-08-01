import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  markRetryOutboxConsumed,
  type WorkflowCompletionReconciliationRecord
} from './workflow-completion-reconciliation-store'
import { terminalizeWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

export function consumeWorkflowRetryOutbox(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  record: WorkflowCompletionReconciliationRecord
): WorkflowStepRunRecord | null {
  if (record.retryOutboxState !== 'pending' || record.state !== 'settled') {
    return null
  }
  const db = store.persistenceDb
  const failed = store.getStep(record.stepRunId)
  if (!failed || !failed.assignment) {
    markRetryOutboxConsumed(db, record.receiptId, record.stepRunId)
    return null
  }
  const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === failed.nodeId)
  if (!node || (node.type !== 'decide' && node.type !== 'review')) {
    markRetryOutboxConsumed(db, record.receiptId, record.stepRunId)
    return null
  }
  // CAS: only one consumer may create the successor attempt.
  const claimed = db
    .prepare(
      `UPDATE workflow_completion_reconciliations
       SET retry_outbox_state = 'consumed', updated_at = datetime('now')
       WHERE receipt_id = ? AND state = 'settled' AND retry_outbox_state = 'pending'`
    )
    .run(record.receiptId)
  if (claimed.changes !== 1) {
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
  db.prepare(
    `UPDATE workflow_completion_reconciliations
     SET retry_step_run_id = ?, updated_at = datetime('now')
     WHERE receipt_id = ?`
  ).run(retry.id, record.receiptId)
  store.insertEvent(run.id, node.type === 'review' ? 'review-fan-out' : 'step-retried', retry.id, {
    retryOfStepRunId: failed.id,
    attempt: retry.attempt,
    receiptId: record.receiptId
  })
  return retry
}

export function terminalizeWorkflowStepOwnership(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): void {
  const assignmentKey = step.assignment
    ? `${step.assignment.slotId}:${step.assignment.agentLifecycleId}`
    : 'engine'
  terminalizeWorkflowDispatchOwnership(store.persistenceDb, {
    runId: run.id,
    nodeId: step.nodeId,
    round: step.round,
    assignmentKey,
    stepRunId: step.id
  })
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
