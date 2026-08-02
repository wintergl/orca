import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  assertPreparedCompletionReady,
  type WorkflowPreparedCompletion
} from './workflow-completion-prepare'
import { reconcileWorkflowStepSuccess } from './workflow-completion-success-reconciler'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

/**
 * Produce success: receipt first, then freeze+CAS artifact, then workflow settle.
 */
export async function finishWorkflowProduce(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion
}): Promise<string | null> {
  assertPreparedCompletionReady(params.prepared, params.step)
  const result = await reconcileWorkflowStepSuccess({
    store: params.store,
    orchestration: params.orchestration,
    runtime: params.runtime,
    run: params.run,
    step: params.step,
    prepared: params.prepared
  })
  if (result.conflict) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce success lost the attempt outcome race.'
    )
  }
  return result.nextNodeId
}
