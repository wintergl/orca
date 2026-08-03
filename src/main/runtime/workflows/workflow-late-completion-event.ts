import type { WorkflowRuntimeStore } from './workflow-runtime-store'

export function recordWorkflowLateCompletionIgnored(
  runtime: WorkflowRuntimeStore,
  runId: string,
  stepRunId: string,
  payload: Record<string, unknown>
): void {
  const exists = runtime
    .events(runId)
    .events.some(
      (event) => event.type === 'late-completion-ignored' && event.stepRunId === stepRunId
    )
  if (!exists) {
    runtime.insertEvent(runId, 'late-completion-ignored', stepRunId, payload)
  }
}
