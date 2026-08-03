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

type WorkflowV2FailureHost = {
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
    return insertV2RetryStep(store, params.run, current)
  }
  if (policy?.onExhausted === 'human') {
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = 'completion-incomplete',
             current_node_id = ?, version = version + 1, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(current.nodeId, params.run.id)
    store.insertEvent(params.run.id, 'review-waiting', current.id, {
      schemaVersion: 2,
      waitingReason: 'completion-incomplete',
      stepId: current.nodeId
    })
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

export function insertV2RetryStep(
  store: WorkflowV2FailureHost,
  run: WorkflowRunRecord,
  failed: WorkflowStepRunRecord
): WorkflowStepRunRecord {
  if (!failed.assignment) {
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
  // Temporarily mask other assignments so only the failed agent is re-queued.
  const maskedRun: WorkflowRunRecord = {
    ...run,
    assignments: run.assignments.filter(
      (assignment) =>
        assignment.nodeId === failed.nodeId &&
        assignment.slotId === failed.assignment!.slotId &&
        assignment.agentLifecycleId === failed.assignment!.agentLifecycleId
    )
  }
  const created = insertWorkflowV2Steps(surface, maskedRun, definition, failed.nodeId, failed.round)
  const match = created[0]
  if (!match) {
    throw new WorkflowError('workflow_context_mismatch', 'V2 retry step was not created.')
  }
  store.db
    .prepare(`UPDATE workflow_step_runs SET attempt = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(failed.attempt + 1, match.id)
  store.insertEvent(run.id, 'step-retried', match.id, {
    retryOfStepRunId: failed.id,
    attempt: failed.attempt + 1,
    schemaVersion: 2
  })
  const refreshed = store.getStep(match.id)
  if (!refreshed) {
    throw new WorkflowError('workflow_not_found', 'V2 retry step disappeared after insert.')
  }
  return refreshed
}
