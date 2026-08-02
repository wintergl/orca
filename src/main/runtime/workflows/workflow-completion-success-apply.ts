import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type {
  WorkflowCompletionEnvelopeV1,
  WorkflowDecisionV1,
  WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import { freezeWorkflowArtifact } from './workflow-artifact-store'
import {
  advanceWorkflowCompletionState,
  type WorkflowCompletionReconciliationRecord,
  type WorkflowCompletionResolution
} from './workflow-completion-reconciliation-store'
import type { WorkflowSuccessPayload } from './workflow-completion-success-payload'
import { terminalizeWorkflowStepOwnership } from './workflow-completion-retry-outbox'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import type { WorkflowWorkspaceBaseline } from './workflow-workspace-snapshot'

/** Freeze after receipt ownership; idempotent via (run, step, digest). */
export async function ensureProduceArtifact(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord
): Promise<WorkflowCompletionReconciliationRecord> {
  const payload = record.successPayload
  if (!payload || payload.nodeType !== 'produce') {
    return record
  }
  if (payload.artifactRevisionId) {
    return record
  }
  const envelope = payload.value as WorkflowCompletionEnvelopeV1
  const artifact = await freezeWorkflowArtifact({
    store,
    run,
    step,
    envelope,
    baseline: store.getBaseline(run.id) as WorkflowWorkspaceBaseline,
    workerFilesModified: payload.filesModified
  })
  const nextPayload: WorkflowSuccessPayload = {
    ...payload,
    artifactRevisionId: artifact.id
  }
  return (
    advanceWorkflowCompletionState(
      store.persistenceDb,
      record.receiptId,
      'orchestration-settled',
      'orchestration-settled',
      { successPayload: nextPayload }
    ) ?? { ...record, successPayload: nextPayload }
  )
}

/** Business write + reconciliation CAS in one Workflow transaction. */
export function applyWorkflowSuccessWriteAtomic(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord
): string | null {
  const payload = record.successPayload
  if (!payload) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Success reconciliation is missing its recoverable result snapshot.'
    )
  }
  const advance = run.status === 'running'
  return store.transaction(() => {
    let nextNodeId: string | null = null
    if (payload.nodeType === 'produce') {
      nextNodeId = applyProduceInTransaction(store, run, step, record, payload, advance)
    } else if (payload.nodeType === 'review') {
      applyReviewInTransaction(store, run, step, record, payload)
    } else {
      applyDecisionInTransaction(store, run, step, record, payload, advance)
    }
    advanceWorkflowCompletionState(
      store.persistenceDb,
      record.receiptId,
      'orchestration-settled',
      'workflow-settled'
    )
    return nextNodeId
  })
}

/**
 * Atomically fail-close Workflow and seal reconciliation with a fail-close resolution.
 * Never advances through a bare orchestration-settled success branch.
 */
export function applyFailCloseAtomic(params: {
  store: WorkflowStore
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  record: WorkflowCompletionReconciliationRecord
  resolution: Extract<
    WorkflowCompletionResolution,
    'conflict-fail-close' | 'post-receipt-fail-close'
  >
  code: string
  message: string
}): WorkflowCompletionReconciliationRecord {
  const recovery = 'Inspect Orchestration and Step evidence; do not auto-retry this attempt.'
  const from = params.record.state
  if (from !== 'received' && from !== 'orchestration-settled' && from !== 'workflow-settled') {
    return params.record
  }
  const advanced = params.store.transaction(() => {
    terminalizeWorkflowStepOwnership(params.store, params.run, params.step)
    const step = params.store.getStep(params.step.id)
    if (
      step &&
      !['failed', 'succeeded', 'cancelled', 'completion-incomplete'].includes(step.status)
    ) {
      params.store.failRunInTransaction({
        runId: params.run.id,
        stepRunId: params.step.id,
        code: params.code,
        message: params.message,
        recovery,
        incomplete: true
      })
    }
    if (from === 'workflow-settled') {
      return advanceWorkflowCompletionState(
        params.store.persistenceDb,
        params.record.receiptId,
        'workflow-settled',
        'workflow-settled',
        {
          resolution: params.resolution,
          retryBlocked: true,
          retryOutboxState: 'none',
          errorCode: params.code,
          errorMessage: params.message
        }
      )
    }
    return advanceWorkflowCompletionState(
      params.store.persistenceDb,
      params.record.receiptId,
      from,
      'workflow-settled',
      {
        resolution: params.resolution,
        retryBlocked: true,
        retryOutboxState: 'none',
        errorCode: params.code,
        errorMessage: params.message
      }
    )
  })
  const mid = advanced ?? params.record
  return (
    advanceWorkflowCompletionState(
      params.store.persistenceDb,
      mid.receiptId,
      'workflow-settled',
      'settled'
    ) ?? mid
  )
}

export function isTransientStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  return (
    /SQLITE_BUSY|database is locked|EAGAIN|EBUSY|EIO|ENOSPC|ETIMEDOUT/i.test(message) ||
    /SQLITE_BUSY|ERR_SQLITE/i.test(code)
  )
}

function applyProduceInTransaction(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord,
  payload: WorkflowSuccessPayload,
  advance: boolean
): string | null {
  if (!payload.artifactRevisionId) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce success reconciliation is missing its Artifact Revision.'
    )
  }
  const artifact = store.getArtifact(payload.artifactRevisionId)
  if (!artifact) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      'Produce success Artifact Revision is unavailable for settlement.'
    )
  }
  const reviewSteps = store.completeProduceInTransaction({
    run,
    step,
    envelope: payload.value,
    conclusionMarkdown: payload.conclusionMarkdown,
    source: payload.source,
    digest: record.messageDigest,
    sourceIdentity: payload.sourceIdentity,
    sourceReference: payload.sourceReference,
    warnings: payload.warnings,
    artifact,
    advance
  })
  return advance ? (reviewSteps[0]?.nodeId ?? run.currentNodeId) : null
}

function applyReviewInTransaction(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord,
  payload: WorkflowSuccessPayload
): void {
  const result = payload.value as WorkflowReviewResultV1
  store.completeReviewInTransaction({
    run,
    step,
    result,
    conclusionMarkdown: payload.conclusionMarkdown,
    source: payload.source,
    digest: record.messageDigest,
    sourceIdentity: payload.sourceIdentity,
    sourceReference: payload.sourceReference,
    warnings: payload.warnings,
    verdict: result.verdict
  })
}

function applyDecisionInTransaction(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  record: WorkflowCompletionReconciliationRecord,
  payload: WorkflowSuccessPayload,
  advance: boolean
): void {
  const decisionResult = payload.value as WorkflowDecisionV1
  const aggregate = run.reviewAggregates.find(
    (candidate) => candidate.id === decisionResult.reviewAggregateId
  )
  if (!aggregate) {
    throw new WorkflowError(
      'workflow_decision_invalid',
      'Decision success reconciliation referenced an unavailable Review Aggregate.'
    )
  }
  store.completeDecisionInTransaction(
    run,
    step,
    aggregate,
    {
      result: decisionResult,
      source: payload.source,
      digest: record.messageDigest,
      sourceIdentity: payload.sourceIdentity,
      sourceReference: payload.sourceReference,
      warnings: payload.warnings
    },
    advance
  )
}
