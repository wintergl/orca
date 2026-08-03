import type { WorkflowRunStore } from './workflow-run-store'

export function updateWorkflowRunObjective(
  runs: WorkflowRunStore,
  params: { runId: string; objective: string },
  mutation: Parameters<WorkflowRunStore['updateConfiguration']>[1]
) {
  const run = runs.show(params.runId, mutation.callerIdentity)
  return runs.updateConfiguration(
    {
      ...params,
      expectedVersion: run.version,
      policyOverrides: run.policyOverrides,
      promptOverrides: run.promptOverrides
    },
    mutation
  )
}
