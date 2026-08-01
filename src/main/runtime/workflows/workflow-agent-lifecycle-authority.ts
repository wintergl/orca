import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WorkflowError } from './workflow-error'

type WorkflowAgentLifecycleClaim = {
  agentLifecycleId: string
  handle: string
  paneKey: string
  worktreeId: string
  processIncarnation: string
  providerSessionId: string | null
}

const claimsByRuntime = new WeakMap<OrcaRuntimeService, Map<string, WorkflowAgentLifecycleClaim>>()

export function claimWorkflowAgentLifecycle(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
  handle: string
): void {
  assertObservedLifecycle(runtime, assignment)
  const processIncarnation = runtime.getTerminalProcessIncarnation(handle)
  if (!processIncarnation) {
    throw unavailable(assignment.agentLifecycleId, 'Agent process identity is unavailable.')
  }
  const observedProviderSessionId =
    runtime.getExactWorkerProviderSession(handle, 0)?.providerSession.id ?? null
  if (
    assignment.providerSessionId !== null &&
    observedProviderSessionId !== assignment.providerSessionId
  ) {
    throw unavailable(assignment.agentLifecycleId, 'Agent Provider Session changed.')
  }
  const claims = claimsByRuntime.get(runtime) ?? new Map<string, WorkflowAgentLifecycleClaim>()
  claims.set(assignment.paneKey, {
    agentLifecycleId: assignment.agentLifecycleId,
    handle,
    paneKey: assignment.paneKey,
    worktreeId: assignment.worktreeId,
    processIncarnation,
    providerSessionId: assignment.providerSessionId ?? observedProviderSessionId
  })
  claimsByRuntime.set(runtime, claims)
}

export function assertWorkflowAgentLifecycle(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
  handle: string
): string | null {
  assertObservedLifecycle(runtime, assignment)
  const claim = claimsByRuntime.get(runtime)?.get(assignment.paneKey)
  const currentProcessIncarnation = runtime.getTerminalProcessIncarnation(handle)
  const currentProviderSessionId =
    runtime.getExactWorkerProviderSession(handle, 0)?.providerSession.id ?? null
  if (
    !claim ||
    claim.agentLifecycleId !== assignment.agentLifecycleId ||
    claim.handle !== handle ||
    claim.paneKey !== assignment.paneKey ||
    claim.worktreeId !== assignment.worktreeId ||
    claim.processIncarnation !== currentProcessIncarnation
  ) {
    throw unavailable(assignment.agentLifecycleId, 'Agent lifecycle authority changed.')
  }
  const expectedProviderSessionId = claim.providerSessionId ?? assignment.providerSessionId
  if (
    expectedProviderSessionId !== null &&
    currentProviderSessionId !== expectedProviderSessionId
  ) {
    throw unavailable(assignment.agentLifecycleId, 'Agent Provider Session changed.')
  }
  // Why: some providers expose their session only after the first prompt starts.
  claim.providerSessionId ??= currentProviderSessionId
  return claim.providerSessionId
}

export function releaseWorkflowAgentLifecycle(
  runtime: OrcaRuntimeService,
  assignment: WorkflowAgentAssignment
): void {
  const claims = claimsByRuntime.get(runtime)
  const claim = claims?.get(assignment.paneKey)
  if (claim?.agentLifecycleId === assignment.agentLifecycleId) {
    claims?.delete(assignment.paneKey)
  }
}

function assertObservedLifecycle(
  runtime: OrcaRuntimeService,
  assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>
): void {
  const observeLifecycle = runtime.getAgentLifecycleAuthorityIdForPaneKey
  if (typeof observeLifecycle !== 'function') {
    return
  }
  const observedLifecycleId = observeLifecycle.call(runtime, assignment.paneKey)
  if (observedLifecycleId !== assignment.agentLifecycleId) {
    throw unavailable(assignment.agentLifecycleId, 'Main-process lifecycle observation changed.')
  }
}

function unavailable(agentLifecycleId: string, reason: string): WorkflowError {
  return new WorkflowError(
    'workflow_agent_unavailable',
    `Agent is no longer the assigned idle lifecycle in this workspace. ${reason}`,
    { agentLifecycleId, reason }
  )
}
