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
import type { WorkflowCollectedResult } from './workflow-completion-collector'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import type { WorkflowWorkspaceBaseline } from './workflow-workspace-snapshot'

export async function finishWorkflowProduce(params: {
  store: WorkflowStore
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  collected: WorkflowCollectedResult<
    WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1
  >
}): Promise<string | null> {
  const { store, run, step, collected } = params
  if (collected.value.schema !== 'workflow.completion/v1') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce returned a non-Completion result.'
    )
  }
  if (collected.value.outcome !== 'succeeded' || !collected.value.readyForNextStep) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce did not return a ready successful Completion envelope.'
    )
  }
  const artifact = await freezeWorkflowArtifact({
    store,
    run,
    step,
    envelope: collected.value,
    baseline: store.getBaseline(run.id) as WorkflowWorkspaceBaseline,
    workerFilesModified: collected.filesModified
  })
  const reviewSteps = store.completeProduce({
    run,
    step,
    envelope: collected.value,
    conclusionMarkdown: collected.value.finalConclusionMarkdown,
    source: collected.source,
    digest: collected.digest,
    sourceIdentity: collected.sourceIdentity,
    sourceReference: collected.sourceReference,
    warnings: collected.warnings,
    artifact,
    advance: run.status === 'running'
  })
  return run.status === 'running' ? (reviewSteps[0]?.nodeId ?? run.currentNodeId) : null
}
