import type { OrchestrationDb } from '../orchestration/db'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowStore } from './workflow-store'

const REPLACED_STEP_STATUSES = new Set<WorkflowStepRunRecord['status']>([
  'waiting-agent',
  'completion-incomplete',
  'timed-out',
  'failed'
])

export function recordIgnoredLateCompletions(params: {
  store: Pick<WorkflowStore, 'recordLateCompletionIgnored' | 'runEvents'>
  orchestration: Pick<OrchestrationDb, 'getRunMailboxHistory' | 'getTask'>
  run: WorkflowRunRecord
}): void {
  if (!params.run.orchestrationRunId) {
    return
  }
  const recorded = new Set(
    params.store
      .runEvents(params.run.id)
      .events.filter((event) => event.type === 'late-completion-ignored')
      .map((event) => event.stepRunId)
  )
  const messages = params.orchestration.getRunMailboxHistory(params.run.orchestrationRunId, 500, [
    'worker_done'
  ])
  for (const step of params.run.steps) {
    const replacement = replacementFor(params.run.steps, step)
    if (
      !replacement ||
      recorded.has(step.id) ||
      !REPLACED_STEP_STATUSES.has(step.status) ||
      !step.taskId ||
      !step.dispatchId ||
      params.orchestration.getTask(step.taskId)?.status !== 'completed' ||
      !messages.some((message) => isCompletionFor(message.payload, step))
    ) {
      continue
    }
    params.store.recordLateCompletionIgnored(params.run.id, step.id, {
      taskId: step.taskId,
      dispatchId: step.dispatchId,
      replacementStepRunId: replacement.id,
      round: step.round,
      attempt: step.attempt,
      reason: 'superseded-dispatch'
    })
  }
}

function replacementFor(
  steps: WorkflowStepRunRecord[],
  step: WorkflowStepRunRecord
): WorkflowStepRunRecord | undefined {
  return steps.find(
    (candidate) =>
      candidate.nodeId === step.nodeId &&
      candidate.round === step.round &&
      candidate.inputArtifactRevisionId === step.inputArtifactRevisionId &&
      candidate.attempt > step.attempt
  )
}

function isCompletionFor(payload: string | null, step: WorkflowStepRunRecord): boolean {
  try {
    const value = JSON.parse(payload ?? '{}') as Record<string, unknown>
    return value.taskId === step.taskId && value.dispatchId === step.dispatchId
  } catch {
    return false
  }
}
