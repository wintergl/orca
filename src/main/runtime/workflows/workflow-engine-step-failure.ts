import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import { settleWorkflowAttemptOrchestrationFailed } from './workflow-attempt-orchestration-settlement'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

export function failWorkflowEngineStep(
  store: WorkflowStore,
  orchestration: OrchestrationDb,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error instanceof WorkflowError
      ? error.code
      : message.includes('workflow_delivery_uncertain')
        ? 'workflow_delivery_uncertain'
        : 'workflow_agent_unavailable'
  // Why: old task/dispatch must be terminal before a retry attempt is created.
  settleWorkflowAttemptOrchestrationFailed(orchestration, step, message)
  if (step.nodeType === 'review') {
    store.failReviewer({ run, step, code, message, recovery: recoveryFor(code) })
  } else if (step.nodeType === 'decide') {
    store.failDecision({
      run,
      step,
      code: 'workflow_decision_invalid',
      message,
      recovery: 'Inspect the Decision output, then retry or decide manually.'
    })
  } else {
    store.failRun({
      runId: run.id,
      stepRunId: step.id,
      code,
      message,
      recovery: recoveryFor(code),
      incomplete:
        code === 'workflow_completion_incomplete' || code === 'workflow_artifact_unavailable'
    })
  }
}

function recoveryFor(code: string): string {
  switch (code) {
    case 'workflow_delivery_uncertain':
      return 'Inspect the Dispatch before choosing any duplicate-risk retry.'
    case 'workflow_artifact_drifted':
      return 'Regenerate the Artifact Revision before another Review.'
    case 'workflow_artifact_unavailable':
      return 'Fix the Artifact path or snapshot limit, then create a new Run.'
    case 'workflow_completion_incomplete':
      return 'Open the Step evidence and provide a complete bound result envelope.'
    default:
      return 'Retry this Step if the original Agent identity is still valid; otherwise reassign an idle Agent.'
  }
}
