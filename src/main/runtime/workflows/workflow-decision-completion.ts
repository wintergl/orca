import type {
  WorkflowDecisionV1,
  WorkflowReviewResultV1,
  WorkflowCompletionEnvelopeV1
} from '../../../shared/workflow-result-schema'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowCollectedResult } from './workflow-completion-collector'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

export function finishWorkflowDecision(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  collected: WorkflowCollectedResult<
    WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1
  >
): void {
  if (collected.value.schema !== 'workflow.decision/v1') {
    throw new WorkflowError(
      'workflow_decision_invalid',
      'Decision Agent returned a non-Decision result.'
    )
  }
  const decisionResult = collected.value
  const aggregate = run.reviewAggregates.find(
    (candidate) => candidate.id === decisionResult.reviewAggregateId
  )
  if (!aggregate) {
    throw new WorkflowError(
      'workflow_decision_invalid',
      'Decision Agent referenced an unavailable Review Aggregate.'
    )
  }
  store.completeDecision(
    run,
    step,
    aggregate,
    {
      result: decisionResult,
      source: collected.source,
      digest: collected.digest,
      sourceIdentity: collected.sourceIdentity,
      sourceReference: collected.sourceReference,
      warnings: collected.warnings
    },
    run.status === 'running'
  )
}
