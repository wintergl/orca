import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'

export function failWorkflowReviewer(
  store: WorkflowRuntimePersistence,
  params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    code: string
    message: string
    recovery: string
    /** Raw Agent conclusion for attempt diagnostics (not only the parse error). */
    rawAgentText?: string | null
    timedOut?: boolean
    /** When true, only mark the step failed; retry is created by outbox consumer. */
    deferRetry?: boolean
    /** When true, skip technical retry and enter waiting-human exhausted path. */
    skipRetry?: boolean
  }
): WorkflowStepRunRecord | null {
  return store.transaction(() => {
    const current = store.getStep(params.step.id)
    if (!current || ['failed', 'timed-out', 'succeeded'].includes(current.status)) {
      return null
    }
    const status = params.timedOut ? 'timed-out' : 'failed'
    store.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = ?, error_code = ?, error_message = ?, recovery = ?,
             conclusion_markdown = COALESCE(?, conclusion_markdown),
             completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      )
      .run(
        status,
        params.code,
        params.message,
        params.recovery,
        params.rawAgentText?.trim() || null,
        current.id
      )
    store.insertEvent(
      params.run.id,
      params.timedOut ? 'reviewer-timed-out' : 'reviewer-failed',
      current.id,
      { code: params.code, attempt: current.attempt }
    )
    const node = params.run.templateSnapshot.nodes.find(
      (candidate) => candidate.id === current.nodeId
    )
    if (node?.type !== 'review' || !current.assignment) {
      failReviewerRun(store, params)
      return null
    }
    if (!params.skipRetry && current.attempt < node.retryPolicy.maxAttempts) {
      if (params.deferRetry) {
        return null
      }
      const retry = store.insertStep(
        params.run.id,
        node,
        current.assignment,
        current.inputArtifactRevisionId,
        'queued',
        current.round,
        current.attempt + 1
      )
      store.insertEvent(params.run.id, 'review-fan-out', retry.id, {
        retryOfStepRunId: current.id,
        attempt: retry.attempt,
        deliveryId: retry.deliveryId
      })
      return retry
    }
    if (node.reviewPolicy.onReviewerFailure === 'fail-run') {
      failReviewerRun(store, params)
      return null
    }
    const context = failureResolutionContext(params.run, current)
    store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = 'reviewer-retry-exhausted',
             resolution_context_json = ?,
             failure_code = ?, failure_message = ?, recovery = ?,
             completed_at = NULL, version = version + 1, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(JSON.stringify(context), params.code, params.message, params.recovery, params.run.id)
    store.insertEvent(params.run.id, 'review-waiting', current.id, {
      waitingReason: 'reviewer-retry-exhausted',
      resolutionContext: context
    })
    return null
  })
}

function failureResolutionContext(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): WorkflowRunRecord['resolutionContext'] {
  const reviewTransition = run.templateSnapshot.transitions.find(
    (transition) => transition.from === step.nodeId && transition.when === 'step:succeeded'
  )
  const decisionNodeId =
    typeof reviewTransition?.to === 'string' ? reviewTransition.to : step.nodeId
  const approve = run.templateSnapshot.transitions.find(
    (transition) => transition.from === decisionNodeId && transition.when === 'decision:approve'
  )
  const revise = run.templateSnapshot.transitions.find(
    (transition) => transition.from === decisionNodeId && transition.when === 'decision:revise'
  )
  return {
    originDecisionStepId: step.id,
    originDecisionNodeId: decisionNodeId,
    reviewNodeId: step.nodeId,
    artifactRevisionId: step.inputArtifactRevisionId ?? 'artifact-unavailable',
    approveTransitionId: approve?.id ?? 'run-resolution:unavailable',
    reviseTransitionId: revise?.id ?? 'run-resolution:retry-step'
  }
}

export function reviewFailureCanRetry(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): boolean {
  const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === step.nodeId)
  return Boolean(
    node?.type === 'review' && step.assignment && step.attempt < node.retryPolicy.maxAttempts
  )
}

function failReviewerRun(
  store: WorkflowRuntimePersistence,
  params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    code: string
    message: string
    recovery: string
  }
): void {
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'failed', failure_code = ?, failure_message = ?, recovery = ?,
           completed_at = datetime('now'), version = version + 1, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(params.code, params.message, params.recovery, params.run.id)
  store.insertEvent(params.run.id, 'run-failed', params.step.id, {
    code: params.code,
    message: params.message
  })
}
