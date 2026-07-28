import type { PaneAgentLifecycle } from '@/store/slices/pane-agent-lifecycle'
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext,
  AgentType
} from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/types'
import { resolveCompatibleAgentTypeForOwner } from '../../../../shared/agent-title-owner'
import { resolveAgentTypeFromTerminalTitle } from './worktree-title-derived-agent-rows'

export function resolveWorktreeRowAgentType(
  entry: AgentStatusEntry,
  tab?: TerminalTab | null
): AgentType {
  const entryAgentType = resolveCompatibleAgentTypeForOwner(entry.agentType, tab?.launchAgent)
  if (entryAgentType && entryAgentType !== 'unknown') {
    return entryAgentType
  }
  return (
    resolveAgentTypeFromTerminalTitle(entry.terminalTitle ?? tab?.title, tab?.launchAgent) ??
    tab?.launchAgent ??
    entryAgentType ??
    'unknown'
  )
}

function orchestrationContextsEqual(
  a: AgentStatusOrchestrationContext,
  b: AgentStatusOrchestrationContext
): boolean {
  return (
    a.taskId === b.taskId &&
    a.dispatchId === b.dispatchId &&
    a.taskTitle === b.taskTitle &&
    a.displayName === b.displayName &&
    a.parentTerminalHandle === b.parentTerminalHandle &&
    a.parentPaneKey === b.parentPaneKey &&
    a.coordinatorHandle === b.coordinatorHandle &&
    a.orchestrationRunId === b.orchestrationRunId
  )
}

export function entryWithRuntimeOrchestration(
  entry: AgentStatusEntry,
  runtimeAgentOrchestrationByPaneKey: Record<string, AgentStatusOrchestrationContext> | undefined
): AgentStatusEntry {
  const runtimeOrchestration = runtimeAgentOrchestrationByPaneKey?.[entry.paneKey]
  const sameDispatch =
    entry.orchestration &&
    runtimeOrchestration &&
    entry.orchestration.taskId === runtimeOrchestration.taskId &&
    entry.orchestration.dispatchId === runtimeOrchestration.dispatchId
  if (entry.orchestration && runtimeOrchestration && !sameDispatch) {
    return entry
  }
  const orchestration =
    sameDispatch && entry.orchestration && runtimeOrchestration
      ? { ...entry.orchestration, ...runtimeOrchestration }
      : (runtimeOrchestration ?? entry.orchestration)
  if (!orchestration || orchestration === entry.orchestration) {
    return entry
  }
  if (entry.orchestration && orchestrationContextsEqual(entry.orchestration, orchestration)) {
    return entry
  }
  // Why: runtime graph metadata can arrive after a hook status ping. Keep old
  // fields only for the same dispatch; a reused terminal must not inherit a
  // previous worker's stale parent.
  return { ...entry, orchestration }
}

export function entryWithLifecycle(
  entry: AgentStatusEntry,
  lifecycle: PaneAgentLifecycle | undefined
): AgentStatusEntry {
  if (!lifecycle) {
    return entry
  }
  const lifecycleChanged =
    entry.agentLifecycleId !== undefined && entry.agentLifecycleId !== lifecycle.id
  const { providerSession: previousProviderSession, ...withoutProviderSession } = entry
  // Why: a PTY replacement creates a new authority before its new hook arrives;
  // do not let the predecessor's Provider Session make that new pane navigable.
  return {
    ...(lifecycleChanged ? withoutProviderSession : entry),
    executionHostId: lifecycle.executionHostId,
    agentLifecycleId: lifecycle.id,
    agentSessionStartedAt: lifecycle.startedAt,
    ...(lifecycleChanged
      ? {}
      : previousProviderSession
        ? { providerSession: previousProviderSession }
        : {})
  }
}
