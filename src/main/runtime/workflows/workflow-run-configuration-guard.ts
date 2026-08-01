import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'

export function assertWorkflowRunConfigurable(run: WorkflowRunRecord): void {
  if (run.status !== 'draft' && run.status !== 'ready') {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Only a Draft or Ready Workflow can change its configuration.'
    )
  }
}
