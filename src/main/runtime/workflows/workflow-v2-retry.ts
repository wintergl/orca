import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  isWorkflowRunSnapshotV2,
  requireWorkflowDefinitionV2
} from '../../../shared/workflow-definition-access'
import { workflowV2StepById } from '../../../shared/workflow-v2-graph'
import type Database from '../../sqlite/sync-database'
import { WorkflowError } from './workflow-error'
import { insertWorkflowV2Steps } from './workflow-v2-advance'
import type { WorkflowV2RuntimeSurface } from './workflow-v2-run-controller'

export type WorkflowV2FailureHost = {
  db: Database.Database
  getStep(stepRunId: string): WorkflowStepRunRecord | null
  insertEvent: WorkflowV2RuntimeSurface['insertEvent']
  insertStep: WorkflowV2RuntimeSurface['insertStep']
  finishEngineStep: WorkflowV2RuntimeSurface['finishEngineStep']
}

export function workflowV2StepRetryPolicy(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): { maxAttempts: number; onExhausted: 'fail-run' | 'human' } | null {
  if (!isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    return null
  }
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot as never, 'V2 retry')
  const stepDef = workflowV2StepById(definition, step.nodeId)
  if (!stepDef || (stepDef.kind !== 'agent' && stepDef.kind !== 'decision')) {
    return null
  }
  return {
    maxAttempts: stepDef.retryPolicy.maxAttempts,
    onExhausted: stepDef.retryPolicy.onExhausted
  }
}

export function workflowV2FailureCanRetry(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): boolean {
  const policy = workflowV2StepRetryPolicy(run, step)
  if (!policy || !step.assignment) {
    return false
  }
  return step.attempt < policy.maxAttempts
}

/**
 * Mark V2 produce-mapped step failed; optional deferred retry via outbox.
 * When attempts exhausted, park on human if configured, otherwise fail the Run.
 */
export function applyWorkflowV2StepFailure(
  store: WorkflowV2FailureHost,
  params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    code: string
    message: string
    recovery: string
    rawAgentText?: string | null
    deferRetry?: boolean
    skipRetry?: boolean
  }
): WorkflowStepRunRecord | null {
  const current = store.getStep(params.step.id)
  if (!current || ['failed', 'succeeded', 'cancelled'].includes(current.status)) {
    return null
  }
  store.db
    .prepare(
      `UPDATE workflow_step_runs
       SET status = 'failed', error_code = ?, error_message = ?, recovery = ?,
           conclusion_markdown = COALESCE(?, conclusion_markdown),
           completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    )
    .run(
      params.code,
      params.message,
      params.recovery,
      params.rawAgentText?.trim() || null,
      current.id
    )
  store.insertEvent(params.run.id, 'completion-incomplete', current.id, {
    code: params.code,
    message: params.message,
    schemaVersion: 2
  })
  const policy = workflowV2StepRetryPolicy(params.run, current)
  const canRetry =
    !params.skipRetry &&
    Boolean(policy) &&
    Boolean(current.assignment) &&
    workflowV2FailureCanRetry(params.run, current)
  if (canRetry) {
    if (params.deferRetry) {
      return null
    }
    return createAndPublishV2RetryStep(store, params.run, current)
  }
  if (policy?.onExhausted === 'human') {
    parkV2RecoveryWaitingHuman(store, params.run, current)
    return null
  }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'failed', failure_code = ?, failure_message = ?, recovery = ?,
           completed_at = datetime('now'), version = version + 1, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(params.code, params.message, params.recovery, params.run.id)
  store.insertEvent(params.run.id, 'run-failed', current.id, {
    code: params.code,
    message: params.message,
    schemaVersion: 2
  })
  return null
}

export function parkV2RecoveryWaitingHuman(
  store: WorkflowV2FailureHost,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord
): void {
  const context = {
    originDecisionStepId: failed.id,
    originDecisionNodeId: failed.nodeId,
    reviewNodeId: failed.nodeId,
    artifactRevisionId: '',
    approveTransitionId: 'v2-recovery',
    reviseTransitionId: 'v2-recovery'
  }
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'waiting-human', waiting_reason = 'completion-incomplete',
           current_node_id = ?, resolution_context_json = ?,
           version = version + 1, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(failed.nodeId, JSON.stringify(context), run.id)
  store.insertEvent(run.id, 'review-waiting', failed.id, {
    schemaVersion: 2,
    waitingReason: 'completion-incomplete',
    stepId: failed.nodeId,
    resolutionContext: context
  })
}

/**
 * Insert only the successor Step (native attempt). Does not emit events or mutate Run.
 * Callers that own outbox CAS must publish after claim succeeds.
 */
export function insertV2RetryStep(
  store: WorkflowV2FailureHost,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord,
  assignment: WorkflowStepRunRecord['assignment'] = failed.assignment
): WorkflowStepRunRecord {
  if (!assignment) {
    throw new WorkflowError('workflow_context_mismatch', 'V2 retry requires an assignment.')
  }
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot as never, 'V2 retry insert')
  const stepDef = workflowV2StepById(definition, failed.nodeId)
  if (!stepDef || (stepDef.kind !== 'agent' && stepDef.kind !== 'decision')) {
    throw new WorkflowError('workflow_transition_invalid', 'V2 retry target is not executable.')
  }
  const surface: WorkflowV2RuntimeSurface = {
    db: store.db,
    finishEngineStep: store.finishEngineStep,
    insertEvent: store.insertEvent,
    getStep: (id) => store.getStep(id) ?? null,
    insertStep: store.insertStep
  }
  const maskedRun: WorkflowRunRecord = {
    ...run,
    assignments: [
      {
        nodeId: failed.nodeId,
        slotId: assignment.slotId,
        worktreeId: assignment.worktreeId,
        executionHostId: assignment.executionHostId,
        paneKey: assignment.paneKey,
        agentLifecycleId: assignment.agentLifecycleId,
        providerSessionId: assignment.providerSessionId,
        runtimeAgent: assignment.runtimeAgent
      }
    ]
  }
  const nextAttempt = failed.attempt + 1
  const created = insertWorkflowV2Steps(
    surface,
    maskedRun,
    definition,
    failed.nodeId,
    failed.round,
    nextAttempt
  )
  const match = created[0]
  if (!match) {
    throw new WorkflowError('workflow_context_mismatch', 'V2 retry step was not created.')
  }
  return match
}

/** Emit step-retried and restore Run to running after outbox ownership is claimed. */
export function publishV2RetryStep(
  store: WorkflowV2FailureHost,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord,
  retry: WorkflowStepRunRecord
): WorkflowStepRunRecord {
  store.insertEvent(run.id, 'step-retried', retry.id, {
    retryOfStepRunId: failed.id,
    attempt: retry.attempt,
    schemaVersion: 2
  })
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'running', current_node_id = ?, waiting_reason = NULL,
           resolution_context_json = NULL, failure_code = NULL, failure_message = NULL,
           recovery = NULL, completed_at = NULL, version = version + 1,
           updated_at = datetime('now') WHERE id = ?`
    )
    .run(failed.nodeId, run.id)
  const refreshed = store.getStep(retry.id)
  if (!refreshed) {
    throw new WorkflowError('workflow_not_found', 'V2 retry step disappeared after publish.')
  }
  return refreshed
}

/** Operator/manual retry path: insert Step and publish Run side effects together. */
export function createAndPublishV2RetryStep(
  store: WorkflowV2FailureHost,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord,
  assignment: WorkflowStepRunRecord['assignment'] = failed.assignment
): WorkflowStepRunRecord {
  const retry = insertV2RetryStep(store, run, failed, assignment)
  return publishV2RetryStep(store, run, failed, retry)
}
