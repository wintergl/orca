import type {
  WorkflowAgentAssignment,
  WorkflowRunEventsResult,
  WorkflowRunExportFormat,
  WorkflowRunExportResult,
  WorkflowRunHistoryFilter,
  WorkflowPreflightResult,
  WorkflowRunRecord,
  WorkflowRunSummary,
  WorkflowResolutionOffer,
  WorkflowTemplateRecord,
  WorkflowTemplateScope,
  WorkflowTemplateSnapshot,
  WorkflowWorkspaceRef
} from '../../../../shared/workflow-definition-types'
import type {
  WorkflowRunPolicyOverrides,
  WorkflowRunPromptOverrides
} from '../../../../shared/workflow-run-lineage'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isWorkflowV2FeatureEnabled } from '../../../../shared/workflow-feature-gates'

function requestId(): string {
  return crypto.randomUUID()
}

export function workflowTargetForExecutionHost(executionHostId: string): RuntimeClientTarget {
  const parsed = parseExecutionHostId(executionHostId)
  return parsed?.kind === 'runtime'
    ? { kind: 'environment', environmentId: parsed.environmentId }
    : { kind: 'local' }
}

export function listWorkflowTemplates(
  target: RuntimeClientTarget,
  projectIdentity?: string,
  includeArchived = false
): Promise<WorkflowTemplateRecord[]> {
  return callRuntimeRpc(target, 'workflow.templateList', { projectIdentity, includeArchived })
}

type WorkflowRuntimeSettingsResult = {
  settings: { 'workflows.v2.enabled'?: boolean }
}

export async function getWorkflowV2FeatureEnabled(target: RuntimeClientTarget): Promise<boolean> {
  const result = await callRuntimeRpc<WorkflowRuntimeSettingsResult>(target, 'settings.get')
  return isWorkflowV2FeatureEnabled(result.settings)
}

export async function setWorkflowV2FeatureEnabled(
  target: RuntimeClientTarget,
  enabled: boolean
): Promise<boolean> {
  const result = await callRuntimeRpc<WorkflowRuntimeSettingsResult>(target, 'settings.update', {
    'workflows.v2.enabled': enabled
  })
  return isWorkflowV2FeatureEnabled(result.settings)
}

export function createWorkflowTemplate(
  target: RuntimeClientTarget,
  input: {
    name: string
    scope: Exclude<WorkflowTemplateScope, 'built-in'>
    projectIdentity?: string
    definition: WorkflowTemplateSnapshot
  }
): Promise<WorkflowTemplateRecord> {
  return callRuntimeRpc(target, 'workflow.templateCreate', { requestId: requestId(), ...input })
}

export function updateWorkflowTemplate(
  target: RuntimeClientTarget,
  input: {
    templateId: string
    expectedVersion: number
    name: string
    projectIdentity?: string
    definition: WorkflowTemplateSnapshot
  }
): Promise<WorkflowTemplateRecord> {
  return callRuntimeRpc(target, 'workflow.templateUpdate', { requestId: requestId(), ...input })
}

export function cloneWorkflowTemplate(
  target: RuntimeClientTarget,
  input: {
    sourceTemplateId: string
    name: string
    scope: Exclude<WorkflowTemplateScope, 'built-in'>
    sourceProjectIdentity?: string
    projectIdentity?: string
  }
): Promise<WorkflowTemplateRecord> {
  return callRuntimeRpc(target, 'workflow.templateClone', { requestId: requestId(), ...input })
}

export function archiveWorkflowTemplate(
  target: RuntimeClientTarget,
  templateId: string,
  projectIdentity?: string
): Promise<WorkflowTemplateRecord> {
  return callRuntimeRpc(target, 'workflow.templateArchive', {
    requestId: requestId(),
    templateId,
    projectIdentity
  })
}

export function createWorkflowRun(
  target: RuntimeClientTarget,
  input: {
    templateId: string
    projectIdentity: string
    workspace: WorkflowWorkspaceRef
    executionHostId: string
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runCreate', { requestId: requestId(), ...input })
}

export function createWorkflowRunRerun(
  target: RuntimeClientTarget,
  input: {
    parentRunId: string
    rerunReason?: string | null
    noAdditionalRequirements?: boolean
    objective?: string
    policyOverrides?: WorkflowRunPolicyOverrides | null
    promptOverrides?: WorkflowRunPromptOverrides | null
    copyAssignments?: boolean
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runCreateRerun', { requestId: requestId(), ...input })
}

export function assignWorkflowAgent(
  target: RuntimeClientTarget,
  input: {
    runId: string
    nodeId: string
    slotId: string
    assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> | null
    removeAgentLifecycleId?: string
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runAssign', { requestId: requestId(), ...input })
}

export function updateWorkflowRunConfiguration(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  input: {
    objective: string
    policyOverrides: WorkflowRunPolicyOverrides | null
    promptOverrides: WorkflowRunPromptOverrides | null
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runUpdate', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version,
    ...input
  })
}

export function switchWorkflowRunTemplate(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  templateId: string
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runSwitchTemplate', {
    requestId: requestId(),
    runId: run.id,
    templateId,
    expectedVersion: run.version
  })
}

export function prepareWorkflowRun(
  target: RuntimeClientTarget,
  runId: string
): Promise<WorkflowPreflightResult> {
  return callRuntimeRpc(target, 'workflow.runPrepare', { requestId: requestId(), runId })
}

export function showWorkflowRun(
  target: RuntimeClientTarget,
  runId: string
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runShow', { runId })
}

export function listWorkflowRuns(
  target: RuntimeClientTarget,
  filter: WorkflowRunHistoryFilter
): Promise<WorkflowRunSummary[]> {
  return callRuntimeRpc(target, 'workflow.runList', filter)
}

export function exportWorkflowRun(
  target: RuntimeClientTarget,
  runId: string,
  format: WorkflowRunExportFormat
): Promise<WorkflowRunExportResult> {
  return callRuntimeRpc(target, 'workflow.runExport', { runId, format })
}

export function startWorkflowRun(
  target: RuntimeClientTarget,
  runId: string
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runStart', { requestId: requestId(), runId })
}

export function listWorkflowRunEvents(
  target: RuntimeClientTarget,
  runId: string
): Promise<WorkflowRunEventsResult> {
  return callRuntimeRpc(target, 'workflow.runEvents', { runId })
}

export function pauseWorkflowRun(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runPause', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version
  })
}

export function resumeWorkflowRun(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runResume', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version
  })
}

export function cancelWorkflowRun(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  input: {
    reason: string
    confirmation: true
    runningAgentAction: 'preserve-running' | 'request-stop'
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runCancel', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version,
    ...input
  })
}

export function resolveWorkflowRun(
  target: RuntimeClientTarget,
  runId: string,
  offer: WorkflowResolutionOffer,
  input: {
    reason?: string
    reviewRoundBudget?: number
    routeTraversalBudget?: number
    confirmation: boolean
  }
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.runResolve', {
    requestId: requestId(),
    runId,
    offerId: offer.id,
    ...input
  })
}

export function retryWorkflowStep(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  stepRunId: string,
  reason?: string
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.stepRetry', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version,
    stepRunId,
    reason
  })
}

export function reassignWorkflowStep(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  stepRunId: string,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
  reason: string
): Promise<WorkflowRunRecord> {
  return callRuntimeRpc(target, 'workflow.stepReassign', {
    requestId: requestId(),
    runId: run.id,
    expectedVersion: run.version,
    stepRunId,
    assignment,
    reason
  })
}
