import { writeFile } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import { claimWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import type { WorkflowMutation } from './workflow-mutation-ledger'
import { workflowReportPath } from './workflow-prompts'
import type { WorkflowStore } from './workflow-store'

export function readyV2Run(
  store: WorkflowStore,
  runtime: OrcaRuntimeService,
  templateId: string,
  slots: [nodeId: string, slotId: string, lifecycle: string, paneKey: string, handle: string][]
): string {
  const created = store.createRun(
    {
      templateId,
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation(`create-${templateId}`)
  )
  for (const [nodeId, slotId, lifecycle, paneKey, handle] of slots) {
    const next = assigned(paneKey, lifecycle)
    store.assignAgent(
      { runId: created.id, nodeId, slotId, assignment: next },
      mutation(`assign-${lifecycle}`)
    )
    claimWorkflowAgentLifecycle(runtime, next, handle)
  }
  store.updateRunObjective(
    { runId: created.id, objective: 'Run the free-form V2 workflow end to end.' },
    mutation(`objective-${templateId}`)
  )
  return store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation(`prepare-${templateId}`)
  ).run.id
}

export function queueV2Completion(
  db: OrchestrationDb,
  handle: string,
  finalText: string,
  delayMs = 0
): void {
  const reportPathPromise = activeWorkflowReportPath(db, handle)
  setTimeout(async () => {
    const reportPath = await reportPathPromise
    await writeFile(
      reportPath,
      JSON.stringify({
        schema: 'workflow.completion/v1',
        outcome: 'succeeded',
        summary: finalText.slice(0, 200),
        finalConclusionMarkdown: finalText,
        artifacts: [],
        validations: [],
        unresolved: [],
        readyForNextStep: true
      })
    )
  }, delayMs)
}

function assigned(
  paneKey: string,
  lifecycle: string
): Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> {
  return {
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey,
    agentLifecycleId: lifecycle,
    providerSessionId: `session-${lifecycle}`,
    runtimeAgent: 'codex'
  }
}

function mutation(requestId: string): WorkflowMutation {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: `test.${requestId}`,
    payload: { requestId }
  }
}

async function activeWorkflowReportPath(db: OrchestrationDb, handle: string): Promise<string> {
  const dispatch = db.getLatestDispatchForTerminal(handle)
  const worker = dispatch ? db.getWorkerDispatch(dispatch.id) : null
  const options = worker ? (JSON.parse(worker.start_options) as Record<string, unknown>) : null
  const runId = typeof options?.workflowRunId === 'string' ? options.workflowRunId : null
  const stepId = typeof options?.workflowStepRunId === 'string' ? options.workflowStepRunId : null
  if (!runId || !stepId) {
    throw new Error(`Active Workflow Dispatch for ${handle} is unavailable.`)
  }
  return workflowReportPath(runId, stepId)
}
