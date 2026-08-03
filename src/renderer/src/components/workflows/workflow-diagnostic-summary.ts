import type {
  WorkflowEventRecord,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'

export function buildWorkflowDiagnosticSummary(
  run: WorkflowRunRecord,
  events: readonly WorkflowEventRecord[]
): string {
  return JSON.stringify(
    {
      run: {
        runId: run.id,
        rootRunId: run.rootRunId,
        parentRunId: run.parentRunId,
        status: run.status,
        version: run.version,
        templateId: run.templateId,
        templateVersion: run.templateVersion,
        decisionProtocolVersion: run.templateSnapshot.decisionProtocolVersion,
        executionHostId: run.executionHostId,
        workspaceKind: run.workspace.kind,
        waitingReason: run.waitingReason,
        terminalReason: run.failureCode
      },
      steps: run.steps.map((step) => ({
        stepRunId: step.id,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        localRunCycle: step.round,
        lineageCycle: run.lineageCycleBase + step.round,
        attempt: step.attempt,
        status: step.status,
        taskId: step.taskId,
        dispatchId: step.dispatchId,
        agentId: step.assignment?.agentLifecycleId ?? null,
        errorCode: step.errorCode
      })),
      events: events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        stepRunId: event.stepRunId,
        ...diagnosticEventKeys(event.payload)
      }))
    },
    null,
    2
  )
}

function diagnosticEventKeys(payload: unknown): Record<string, string | number | null> {
  if (!payload || typeof payload !== 'object') {
    return {}
  }
  const record = payload as Record<string, unknown>
  return Object.fromEntries(
    [
      'routeId',
      'retryReason',
      'terminalReason',
      'receiptId',
      'taskId',
      'dispatchId',
      'attempt'
    ].flatMap((key) => {
      const value = record[key]
      return typeof value === 'string' || typeof value === 'number' || value === null
        ? [[key, value] as const]
        : []
    })
  )
}
