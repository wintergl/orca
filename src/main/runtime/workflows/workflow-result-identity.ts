import type {
  WorkflowCompletionEnvelopeV1,
  WorkflowDecisionV1,
  WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'

export function assertWorkflowResultIdentity(
  value: WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): void {
  const assignment = step.assignment
  if (
    !assignment ||
    value.workflowRunId !== run.id ||
    value.stepRunId !== step.id ||
    value.taskId !== step.taskId ||
    value.dispatchId !== step.dispatchId ||
    value.agentLifecycleId !== assignment.agentLifecycleId ||
    value.providerSessionId !== assignment.providerSessionId ||
    value.executionHostId !== run.executionHostId
  ) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'The Workflow result identity does not match the active Dispatch.'
    )
  }
}
