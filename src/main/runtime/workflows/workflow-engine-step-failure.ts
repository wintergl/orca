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
  const code = classifyWorkflowStepFailure(error, message)
  // Why: never auto-retry when ownership/delivery cannot be closed cleanly.
  if (isHumanWaitFailureCode(code)) {
    store.markRecoveryWaiting(
      run,
      step,
      code === 'workflow_lifecycle_mismatch' ? 'lifecycle-mismatch' : 'delivery-uncertain',
      message
    )
    return
  }
  const settlement = settleWorkflowAttemptOrchestrationFailed(orchestration, step, message)
  if (!settlement.settled) {
    store.markRecoveryWaiting(
      run,
      step,
      'delivery-uncertain',
      `Could not settle Orchestration ownership before retry: ${message}`
    )
    return
  }
  if (step.nodeType === 'review') {
    store.failReviewer({ run, step, code, message, recovery: recoveryFor(code) })
  } else if (step.nodeType === 'decide') {
    store.failDecision({
      run,
      step,
      code: code === 'workflow_completion_incomplete' ? 'workflow_decision_invalid' : code,
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

function classifyWorkflowStepFailure(error: unknown, message: string): string {
  if (error instanceof WorkflowError) {
    return error.code
  }
  if (message.includes('workflow_delivery_uncertain') || message.includes('delivery-uncertain')) {
    return 'workflow_delivery_uncertain'
  }
  if (message.includes('lifecycle-mismatch') || message.includes('workflow_lifecycle_mismatch')) {
    return 'workflow_lifecycle_mismatch'
  }
  return 'workflow_agent_unavailable'
}

function isHumanWaitFailureCode(code: string): boolean {
  return (
    code === 'workflow_delivery_uncertain' ||
    code === 'workflow_lifecycle_mismatch' ||
    code === 'workflow_transport_disconnected'
  )
}

function recoveryFor(code: string): string {
  switch (code) {
    case 'workflow_delivery_uncertain':
      return 'Inspect the Dispatch before choosing any duplicate-risk retry.'
    case 'workflow_lifecycle_mismatch':
      return 'Inspect Agent lifecycle ownership before retrying or reassigning.'
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
