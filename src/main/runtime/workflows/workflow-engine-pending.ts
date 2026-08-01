import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import type { WorkflowStore } from './workflow-store'

export function isActiveWorkflowRunStatus(status: WorkflowRunRecord['status']): boolean {
  return status === 'running' || status === 'paused'
}

export function advancePendingWorkflow(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  callerIdentity: string
): WorkflowRunRecord {
  const currentSteps = run.steps.filter((step) => step.nodeId === run.currentNodeId)
  const latestCurrentStep = currentSteps.toReversed()[0]
  const produce =
    latestCurrentStep?.nodeType === 'produce' && latestCurrentStep.status === 'succeeded'
      ? latestCurrentStep
      : null
  if (produce?.outputArtifactRevisionId) {
    const artifact = run.artifacts.find(
      (candidate) => candidate.id === produce.outputArtifactRevisionId
    )
    if (artifact) {
      store.advanceProduce(run, produce, artifact)
      return store.showRun(run.id, callerIdentity)
    }
  }
  const aggregate = run.reviewAggregates
    .toReversed()
    .find(
      (candidate) =>
        candidate.reviewNodeId === run.currentNodeId &&
        !run.decisions.some((decision) => decision.reviewAggregateId === candidate.id)
    )
  if (aggregate) {
    store.advanceAggregate(run, aggregate)
    return store.showRun(run.id, callerIdentity)
  }
  const decision = run.decisions.toReversed().find((candidate) => {
    const step = run.steps.find((value) => value.id === candidate.stepRunId)
    return step?.nodeId === run.currentNodeId && step.status === 'succeeded'
  })
  if (decision) {
    store.advancePersistedDecision(run, decision)
    return store.showRun(run.id, callerIdentity)
  }
  return run
}
