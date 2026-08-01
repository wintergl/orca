import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import { reconcileWorkflowStepFailure } from './workflow-completion-failure-reconciler'
import type { WorkflowStore } from './workflow-store'

export function failWorkflowEngineStep(
  store: WorkflowStore,
  orchestration: OrchestrationDb,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  error: unknown
): void {
  reconcileWorkflowStepFailure({ store, orchestration, run, step, error })
}
