import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { resolutionContextForAggregate } from './workflow-transition-engine'

export function failWorkflowDecision(
  store: WorkflowRuntimePersistence,
  params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    code: string
    message: string
    recovery: string
    /** When true, only mark the step failed; retry is created by outbox consumer. */
    deferRetry?: boolean
    /** When true, skip technical retry and enter waiting-human path. */
    skipRetry?: boolean
  }
): WorkflowStepRunRecord | null {
  return store.transaction(() => {
    const current = store.getStep(params.step.id)
    if (!current || ['failed', 'succeeded', 'cancelled'].includes(current.status)) {
      return null
    }
    store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'failed', error_code = ?, error_message = ?, recovery = ?,
             completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      )
      .run(params.code, params.message, params.recovery, current.id)
    const node = params.run.templateSnapshot.nodes.find(
      (candidate) => candidate.id === current.nodeId && candidate.type === 'decide'
    )
    const canRetry =
      !params.skipRetry &&
      node?.type === 'decide' &&
      Boolean(current.assignment) &&
      current.attempt < node.retryPolicy.maxAttempts
    if (canRetry) {
      if (params.deferRetry) {
        return null
      }
      const retry = store.insertStep(
        params.run.id,
        node!,
        current.assignment,
        current.inputArtifactRevisionId,
        'queued',
        current.round,
        current.attempt + 1
      )
      store.insertEvent(params.run.id, 'step-retried', retry.id, {
        retryOfStepRunId: current.id,
        attempt: retry.attempt
      })
      return retry
    }
    const aggregate = store
      .listReviewAggregates(params.run.id)
      .toReversed()
      .find((candidate) => candidate.artifactRevisionId === current.inputArtifactRevisionId)
    if (!aggregate) {
      // Why: without a Review Aggregate, approve/revise offers are not executable.
      throw new Error('Decision failure cannot bind its Review Aggregate.')
    }
    const context = resolutionContextForAggregate(params.run, aggregate, current.id)
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = 'decision-invalid',
             resolution_context_json = ?, failure_code = ?, failure_message = ?, recovery = ?,
             completed_at = NULL, version = version + 1, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(JSON.stringify(context), params.code, params.message, params.recovery, params.run.id)
    store.insertEvent(params.run.id, 'review-waiting', current.id, {
      waitingReason: 'decision-invalid',
      resolutionContext: context
    })
    return null
  })
}

export function decisionFailureCanRetry(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): boolean {
  const node = run.templateSnapshot.nodes.find(
    (candidate) => candidate.id === step.nodeId && candidate.type === 'decide'
  )
  return Boolean(
    node?.type === 'decide' && step.assignment && step.attempt < node.retryPolicy.maxAttempts
  )
}
