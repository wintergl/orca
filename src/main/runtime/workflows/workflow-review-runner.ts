import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  prepareWorkflowStepCompletion,
  type WorkflowPreparedCompletion
} from './workflow-completion-prepare'
import { reconcileWorkflowStepSuccess } from './workflow-completion-success-reconciler'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import { workspaceGuardDigest, type WorkflowWorkspaceBaseline } from './workflow-workspace-snapshot'
import { captureWorkflowAgentCompletion } from './workflow-agent-output-completion'

export async function monitorWorkflowReviewSteps(params: {
  runtime: OrcaRuntimeService
  store: WorkflowStore
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  steps: WorkflowStepRunRecord[]
  failStep: (step: WorkflowStepRunRecord, error: unknown) => void
}): Promise<void> {
  const currentNode = params.run.templateSnapshot.nodes.find(
    (candidate) => candidate.id === params.run.currentNodeId
  )
  const timeoutMs = currentNode?.type === 'review' ? currentNode.reviewPolicy.timeoutMs : null
  const orderedSteps = params.steps.toSorted((left, right) => {
    const leftPending = params.orchestration.getTask(left.taskId ?? '')?.status === 'dispatched'
    const rightPending = params.orchestration.getTask(right.taskId ?? '')?.status === 'dispatched'
    return Number(leftPending) - Number(rightPending)
  })
  for (const step of orderedSteps) {
    if (step.status !== 'running' || !step.taskId || !step.dispatchId) {
      continue
    }
    await captureWorkflowAgentCompletion({
      runtime: params.runtime,
      orchestration: params.orchestration,
      run: params.run,
      step
    })
    try {
      const prepared = await prepareWorkflowStepCompletion({
        runtime: params.runtime,
        orchestration: params.orchestration,
        run: params.run,
        step
      })
      if (prepared.status === 'not-ready') {
        if (isReviewerTimedOut(step, timeoutMs)) {
          timeoutReviewer(params.store, params.run, step)
        }
        continue
      }
      if (prepared.status === 'task-failed') {
        params.failStep(step, new WorkflowError(prepared.code, prepared.message))
        continue
      }
      await finishWorkflowReview(
        params.store,
        params.orchestration,
        params.runtime,
        params.run,
        step,
        prepared.prepared
      )
    } catch (error) {
      params.failStep(params.store.getStep(step.id) ?? step, error)
    }
  }
}

async function finishWorkflowReview(
  store: WorkflowStore,
  orchestration: OrchestrationDb,
  runtime: OrcaRuntimeService,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  prepared: WorkflowPreparedCompletion
): Promise<void> {
  if (prepared.value.schema !== 'workflow.review-result/v1') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Review returned a non-Review result.'
    )
  }
  const afterDigest = await workspaceGuardDigest(
    store.getBaseline(run.id) as WorkflowWorkspaceBaseline
  )
  const beforeDigest = store.getStepReviewGuardDigest(step.id)
  if (!beforeDigest || beforeDigest !== afterDigest) {
    if (step.inputArtifactRevisionId) {
      store.markArtifactDrifted(run.id, step.id, step.inputArtifactRevisionId)
    }
    throw new WorkflowError(
      'workflow_artifact_drifted',
      'The implementation workspace changed during Review.'
    )
  }
  const result = await reconcileWorkflowStepSuccess({
    store,
    orchestration,
    runtime,
    run,
    step,
    prepared
  })
  if (result.conflict) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Review success lost the attempt outcome race.'
    )
  }
}

function timeoutReviewer(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): void {
  store.failReviewer({
    run,
    step,
    code: 'workflow_reviewer_timed_out',
    message: 'The Reviewer exceeded the configured timeout.',
    recovery: 'Inspect the Reviewer evidence before retrying or reassigning.',
    timedOut: true
  })
}

function isReviewerTimedOut(step: WorkflowStepRunRecord, timeoutMs: number | null): boolean {
  if (timeoutMs === null || !step.startedAt) {
    return false
  }
  const startedAt = Date.parse(step.startedAt)
  return Number.isFinite(startedAt) && Date.now() - startedAt >= timeoutMs
}
