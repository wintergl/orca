import type { WorkflowStore } from './workflow-store'

export async function waitForRun(
  store: WorkflowStore,
  runId: string,
  status: 'completed' | 'failed' | 'waiting-human' | 'review-limit-reached'
) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const run = store.showRun(runId, 'user-a')
    if (run.status === status) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const run = store.showRun(runId, 'user-a')
  throw new Error(
    `Workflow Run ${runId} did not reach ${status}; current=${run.status}; steps=${JSON.stringify(
      run.steps.map((step) => [
        step.nodeType,
        step.status,
        step.attempt,
        step.errorCode,
        step.errorMessage
      ])
    )}`
  )
}

export async function waitForStepStatus(
  store: WorkflowStore,
  runId: string,
  nodeType: 'produce' | 'review' | 'decide',
  status: 'succeeded'
) {
  const deadline = Date.now() + 5_000
  let latest: ReturnType<WorkflowStore['showRun']> | null = null
  while (Date.now() < deadline) {
    latest = store.showRun(runId, 'user-a')
    if (latest.steps.some((step) => step.nodeType === nodeType && step.status === status)) {
      return latest
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(
    `Workflow Run ${runId} did not persist a ${nodeType} ${status} Step; ` +
      `current=${latest?.status}; failure=${latest?.failureCode}; steps=${JSON.stringify(
        latest?.steps.map((step) => [step.nodeType, step.status, step.errorCode, step.errorMessage])
      )}`
  )
}
