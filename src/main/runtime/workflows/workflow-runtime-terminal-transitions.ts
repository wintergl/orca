import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'

export function failWorkflowRun(
  store: WorkflowRuntimePersistence,
  params: {
    runId: string
    stepRunId: string
    code: string
    message: string
    recovery: string
    incomplete?: boolean
  }
): void {
  store.transaction(() => failWorkflowRunInTransaction(store, params))
}

/** Caller must hold the Workflow DB transaction. */
export function failWorkflowRunInTransaction(
  store: WorkflowRuntimePersistence,
  params: {
    runId: string
    stepRunId: string
    code: string
    message: string
    recovery: string
    incomplete?: boolean
  }
): void {
  const stepStatus = params.incomplete ? 'completion-incomplete' : 'failed'
  const waitingReason = waitingReasonForFailure(params.code)
  const step = store.getStep(params.stepRunId)
  const context = step
    ? {
        originDecisionStepId: step.id,
        originDecisionNodeId: step.nodeId,
        reviewNodeId: step.nodeType === 'review' ? step.nodeId : 'not-yet-created',
        artifactRevisionId: step.inputArtifactRevisionId ?? 'artifact-unavailable',
        approveTransitionId: 'run-resolution:unavailable',
        reviseTransitionId: 'run-resolution:retry-step'
      }
    : null
  store.db
    .prepare(
      `UPDATE workflow_step_runs
       SET status = ?, delivery_state = CASE WHEN ? = 'workflow_delivery_uncertain'
             THEN 'uncertain' ELSE 'failed' END,
           error_code = ?, error_message = ?, recovery = ?,
           completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    )
    .run(stepStatus, params.code, params.code, params.message, params.recovery, params.stepRunId)
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = ?, waiting_reason = ?, resolution_context_json = ?,
           failure_code = ?, failure_message = ?, recovery = ?,
           completed_at = ?, version = version + 1,
           updated_at = datetime('now') WHERE id = ?`
    )
    .run(
      waitingReason ? 'waiting-human' : 'failed',
      waitingReason,
      context ? JSON.stringify(context) : null,
      params.code,
      params.message,
      params.recovery,
      waitingReason ? null : new Date().toISOString(),
      params.runId
    )
  if (params.incomplete) {
    store.insertEvent(params.runId, 'completion-incomplete', params.stepRunId, {
      code: params.code,
      message: params.message
    })
  }
  store.insertEvent(
    params.runId,
    waitingReason ? 'review-waiting' : 'run-failed',
    params.stepRunId,
    {
      code: params.code,
      message: params.message,
      waitingReason
    }
  )
}

function waitingReasonForFailure(code: string) {
  switch (code) {
    case 'workflow_agent_unavailable':
      return 'agent-unavailable'
    case 'workflow_delivery_uncertain':
      return 'delivery-uncertain'
    case 'workflow_artifact_unavailable':
      return 'artifact-unavailable'
    case 'workflow_artifact_drifted':
      return 'artifact-drifted'
    case 'workflow_completion_incomplete':
      return 'completion-incomplete'
    default:
      return null
  }
}

export function markWorkflowArtifactDrifted(
  store: WorkflowRuntimePersistence,
  runId: string,
  stepRunId: string,
  artifactRevisionId: string
): void {
  store.transaction(() => {
    store.db
      .prepare("UPDATE workflow_artifact_revisions SET snapshot_state = 'drifted' WHERE id = ?")
      .run(artifactRevisionId)
    store.insertEvent(runId, 'artifact-drifted', stepRunId, { artifactRevisionId })
  })
}
