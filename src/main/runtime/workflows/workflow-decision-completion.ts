import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowDecisionV1 } from '../../../shared/workflow-result-schema'
import {
  assertPreparedCompletionReady,
  type WorkflowPreparedCompletion
} from './workflow-completion-prepare'
import { reconcileWorkflowStepSuccess } from './workflow-completion-success-reconciler'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

export async function finishWorkflowDecision(
  store: WorkflowStore,
  orchestration: OrchestrationDb,
  runtime: OrcaRuntimeService,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  prepared: WorkflowPreparedCompletion
): Promise<void> {
  assertPreparedCompletionReady(prepared, step)
  const decisionResult = prepared.value as WorkflowDecisionV1
  const aggregate = run.reviewAggregates.find(
    (candidate) => candidate.id === decisionResult.reviewAggregateId
  )
  if (!aggregate) {
    throw new WorkflowError(
      'workflow_decision_invalid',
      'Decision Agent referenced an unavailable Review Aggregate.'
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
      'workflow_decision_invalid',
      'Decision success lost the attempt outcome race.'
    )
  }
}
