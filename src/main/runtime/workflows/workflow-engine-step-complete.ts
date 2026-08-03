import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowPreparedCompletion } from './workflow-completion-prepare'
import { finishWorkflowDecision } from './workflow-decision-completion'
import { WorkflowError } from './workflow-error'
import { finishWorkflowProduce } from './workflow-produce-completion'
import type { WorkflowStore } from './workflow-store'
import { finishWorkflowV2Step, isWorkflowV2Run } from './workflow-v2-completion'

export async function completePreparedWorkflowStep(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion
  callerIdentity: string
}): Promise<string | null> {
  if (isWorkflowV2Run(params.run)) {
    return finishWorkflowV2Step({
      store: params.store,
      orchestration: params.orchestration,
      runtime: params.runtime,
      run: params.run,
      step: params.step,
      prepared: params.prepared,
      callerIdentity: params.callerIdentity
    })
  }
  if (params.step.nodeType === 'produce') {
    return finishWorkflowProduce({
      store: params.store,
      orchestration: params.orchestration,
      runtime: params.runtime,
      run: params.run,
      step: params.step,
      prepared: params.prepared
    })
  }
  if (params.step.nodeType === 'decide') {
    await finishWorkflowDecision(
      params.store,
      params.orchestration,
      params.runtime,
      params.run,
      params.step,
      params.prepared
    )
    return null
  }
  throw new WorkflowError('workflow_completion_incomplete', 'Unexpected Workflow Step type.')
}
