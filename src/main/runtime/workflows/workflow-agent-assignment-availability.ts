import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import { assertTerminalAgentSendable } from '../rpc/terminal-agent-send-guard'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  assertWorkflowAgentLifecycle,
  claimWorkflowAgentLifecycle
} from './workflow-agent-lifecycle-authority'
import { WorkflowError } from './workflow-error'

export type WorkflowAgentUnavailableReason =
  | 'working'
  | 'permission'
  | 'no-current-agent'
  | 'pane-unavailable'
  | 'lifecycle-changed'

export async function assertWorkflowAssignmentAvailable(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
  options: { claim?: boolean } = {}
): Promise<{ handle: string }> {
  try {
    const observed = await observeIdleWorkflowAgent(runtime, assignment)
    if (options.claim) {
      claimWorkflowAgentLifecycle(runtime, assignment, observed.handle)
    } else {
      assertWorkflowAgentLifecycle(runtime, assignment, observed.handle)
    }
    return { handle: observed.handle }
  } catch (error) {
    throw unavailable(assignment, classifyUnavailableReason(error))
  }
}

export async function resolveWorkflowAssignmentAuthority(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>
): Promise<Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>> {
  try {
    const observed = await observeIdleWorkflowAgent(runtime, assignment)
    return {
      ...assignment,
      agentLifecycleId: observed.agentLifecycleId,
      providerSessionId: observed.providerSessionId
    }
  } catch (error) {
    throw unavailable(assignment, classifyUnavailableReason(error))
  }
}

async function observeIdleWorkflowAgent(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>
): Promise<{ handle: string; agentLifecycleId: string; providerSessionId: string | null }> {
  const resolved = runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
  await assertTerminalAgentSendable({
    runtime,
    handle: resolved.handle,
    requireIdle: true,
    assertWritable: () => {
      const current = runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
      if (current.handle !== resolved.handle) {
        throw new Error('terminal_handle_stale')
      }
    }
  })
  const agentLifecycleId = runtime.getAgentLifecycleAuthorityIdForPaneKey(assignment.paneKey)
  if (!agentLifecycleId) {
    throw new Error('workflow_agent_lifecycle_unavailable')
  }
  return {
    handle: resolved.handle,
    agentLifecycleId,
    providerSessionId:
      runtime.getExactWorkerProviderSession(resolved.handle, 0)?.providerSession.id ?? null
  }
}

export function workflowAgentUnavailableReason(error: unknown): WorkflowAgentUnavailableReason {
  if (error instanceof WorkflowError && isUnavailableReason(error.data)) {
    return error.data.reason
  }
  return classifyUnavailableReason(error)
}

export function workflowAgentUnavailableReasonLabel(
  reason: WorkflowAgentUnavailableReason
): string {
  switch (reason) {
    case 'working':
      return 'Agent is working'
    case 'permission':
      return 'Agent is waiting for permission'
    case 'no-current-agent':
      return 'No current Agent is running in the Pane'
    case 'pane-unavailable':
      return 'Agent Pane is unavailable'
    case 'lifecycle-changed':
      return 'Agent lifecycle or Provider Session changed'
  }
}

function unavailable(
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
  reason: WorkflowAgentUnavailableReason
): WorkflowError {
  return new WorkflowError(
    'workflow_agent_unavailable',
    `${workflowAgentUnavailableReasonLabel(reason)}. Choose a current idle Agent.`,
    {
      agentLifecycleId: assignment.agentLifecycleId,
      paneKey: assignment.paneKey,
      reason
    }
  )
}

function classifyUnavailableReason(error: unknown): WorkflowAgentUnavailableReason {
  const detail =
    error instanceof WorkflowError
      ? `${error.message} ${JSON.stringify(error.data)}`
      : error instanceof Error
        ? error.message
        : String(error)
  if (detail.includes('terminal_guard_not_idle')) {
    return 'working'
  }
  if (detail.includes('terminal_guard_permission')) {
    return 'permission'
  }
  if (detail.includes('terminal_guard_no_agent')) {
    return 'no-current-agent'
  }
  if (
    detail.includes('lifecycle') ||
    detail.includes('Provider Session') ||
    detail.includes('process identity')
  ) {
    return 'lifecycle-changed'
  }
  return 'pane-unavailable'
}

function isUnavailableReason(data: unknown): data is { reason: WorkflowAgentUnavailableReason } {
  if (!data || typeof data !== 'object' || !('reason' in data)) {
    return false
  }
  return [
    'working',
    'permission',
    'no-current-agent',
    'pane-unavailable',
    'lifecycle-changed'
  ].includes(String(data.reason))
}
