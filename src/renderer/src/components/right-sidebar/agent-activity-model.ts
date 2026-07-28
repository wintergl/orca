import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { toAiVaultAgent, type AiVaultSession } from '../../../../shared/ai-vault-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalPaneLayoutNode } from '../../../../shared/types'
import { buildAgentActivityIdentity, encodeAgentActivityDisplayId } from './agent-activity-identity'
import {
  buildAgentActivitySources,
  getCurrentAgentActivityKind,
  isNormalAgentCompletion
} from './agent-activity-sources'
import {
  buildAgentActivityProviderKey,
  indexAgentActivitySessions
} from './agent-activity-session-index'
import { sourceExecutionHostId, visibleInAgentVault } from './agent-activity-visibility'
import type {
  AgentActivityItem,
  AgentActivityKind,
  AgentActivityModel,
  AgentActivityNavigationUnavailableReason,
  AgentActivitySource,
  AgentActivityWorkspaceInfo,
  BuildAgentActivityArgs
} from './agent-activity-types'

export type {
  AgentActivityItem,
  AgentActivityKind,
  AgentActivityModel,
  AgentActivityNavigationTarget,
  AgentActivityNavigationUnavailableReason,
  AgentActivityWorkspaceInfo,
  BuildAgentActivityArgs
} from './agent-activity-types'
function itemState(kind: AgentActivityKind, entry: AgentStatusEntry): AgentActivityItem['state'] {
  if (kind === 'idle') {
    return 'idle'
  }
  if (kind === 'completed') {
    return 'done'
  }
  return entry.state === 'blocked' || entry.state === 'waiting' ? entry.state : 'working'
}

function layoutHasLeaf(node: TerminalPaneLayoutNode | null | undefined, leafId: string): boolean {
  if (!node) {
    return false
  }
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return layoutHasLeaf(node.first, leafId) || layoutHasLeaf(node.second, leafId)
}

function hasAvailableCurrentPane(args: {
  source: AgentActivitySource
  workspace: AgentActivityWorkspaceInfo | undefined
  filters: BuildAgentActivityArgs
}): boolean {
  if (!args.workspace || !args.filters.workspaceInfoById.has(args.source.worktreeId)) {
    return false
  }
  const pane = parsePaneKey(args.source.paneKey)
  if (!pane) {
    return false
  }
  const tabs = args.filters.tabsByWorktree[args.source.worktreeId] ?? []
  if (!tabs.some((tab) => tab.id === pane.tabId)) {
    return false
  }
  return layoutHasLeaf(args.filters.terminalLayoutsByTabId[pane.tabId]?.root, pane.leafId)
}

function buildItem(args: {
  source: AgentActivitySource
  kind: AgentActivityKind
  workspace: AgentActivityWorkspaceInfo | undefined
  sessionByProviderKey: ReadonlyMap<string, AiVaultSession>
  filters: BuildAgentActivityArgs
}): AgentActivityItem {
  const { source, kind, workspace } = args
  const providerSessionId = source.entry.providerSession?.id?.trim() || null
  const vaultAgent = toAiVaultAgent(source.runtimeAgent)
  const executionHostId = sourceExecutionHostId(source, workspace)
  const matchedSession =
    executionHostId && providerSessionId && vaultAgent
      ? (args.sessionByProviderKey.get(
          buildAgentActivityProviderKey({ executionHostId, vaultAgent, providerSessionId })
        ) ?? null)
      : null
  const lifecycleId = source.lifecycle?.id ?? source.entry.agentLifecycleId ?? null
  const activityIdentity = executionHostId
    ? buildAgentActivityIdentity({
        executionHostId,
        worktreeId: source.worktreeId,
        paneKey: source.paneKey,
        runtimeAgent: source.runtimeAgent,
        vaultAgent,
        providerSessionId,
        lifecycleId
      })
    : null
  const paneAvailable = hasAvailableCurrentPane({ source, workspace, filters: args.filters })
  const canNavigate =
    kind !== 'completed' &&
    Boolean(
      executionHostId &&
      lifecycleId &&
      activityIdentity &&
      source.rowSource !== 'retained' &&
      source.lifecycle?.phase !== 'transport-disconnected' &&
      paneAvailable
    )
  const navigationUnavailableReason: AgentActivityNavigationUnavailableReason | null = canNavigate
    ? null
    : source.lifecycle?.phase === 'transport-disconnected'
      ? 'remote-disconnected'
      : !executionHostId
        ? 'host-unresolved'
        : !lifecycleId
          ? 'lifecycle-missing'
          : 'pane-unavailable'
  const title = workspace?.title ?? matchedSession?.title ?? source.entry.terminalTitle ?? 'Agent'
  const completionMessage = isNormalAgentCompletion(source.entry)
    ? source.entry.lastAssistantMessage?.trim() || null
    : null
  const message =
    source.contentEvidence === 'synthetic'
      ? null
      : kind === 'working'
        ? source.entry.prompt?.trim() || source.entry.lastAssistantMessage?.trim() || null
        : kind === 'attention'
          ? source.entry.interactivePrompt?.trim() ||
            source.entry.lastAssistantMessage?.trim() ||
            null
          : completionMessage
  const completedAt = kind === 'completed' ? source.entry.stateStartedAt : null
  const id = activityIdentity
    ? encodeAgentActivityDisplayId([
        kind === 'completed' ? 'completed' : 'current',
        activityIdentity.canonicalKey,
        completedAt
      ])
    : encodeAgentActivityDisplayId([
        kind === 'completed' ? 'legacy-completed' : 'unresolved-current',
        source.paneKey,
        completedAt
      ])
  return {
    id,
    kind,
    state: itemState(kind, source.entry),
    paneKey: source.paneKey,
    worktreeId: source.worktreeId,
    executionHostId,
    runtimeAgent: source.runtimeAgent,
    vaultAgent,
    title,
    subtitle: matchedSession?.title ?? source.entry.model ?? null,
    message,
    completionMessage,
    toolName: source.entry.toolName ?? null,
    toolInput: source.entry.toolInput ?? null,
    interactivePrompt: source.entry.interactivePrompt ?? null,
    startedAt: source.entry.agentSessionStartedAt ?? source.entry.stateStartedAt,
    stateChangedAt: source.entry.stateStartedAt,
    updatedAt: source.entry.updatedAt,
    completedAt,
    providerSessionId,
    agentLifecycleId: lifecycleId,
    agentSessionStartedAt:
      source.lifecycle?.startedAt ?? source.entry.agentSessionStartedAt ?? null,
    activityIdentity,
    matchedSession,
    navigationTarget:
      canNavigate && executionHostId && activityIdentity && lifecycleId
        ? {
            worktreeId: source.worktreeId,
            paneKey: source.paneKey,
            executionHostId,
            runtimeAgent: source.runtimeAgent,
            normalizedVaultAgent: vaultAgent,
            providerSessionId,
            agentLifecycleId: lifecycleId,
            activityIdentity
          }
        : null,
    navigationUnavailableReason
  }
}

function compareItems(left: AgentActivityItem, right: AgentActivityItem): number {
  const leftTime = left.kind === 'completed' ? (left.completedAt ?? 0) : left.stateChangedAt
  const rightTime = right.kind === 'completed' ? (right.completedAt ?? 0) : right.stateChangedAt
  return rightTime - leftTime || left.id.localeCompare(right.id)
}

function compareAttentionItems(left: AgentActivityItem, right: AgentActivityItem): number {
  const priority = (item: AgentActivityItem): number => (item.state === 'waiting' ? 0 : 1)
  return priority(left) - priority(right) || compareItems(left, right)
}

export function buildAgentActivity(args: BuildAgentActivityArgs): AgentActivityModel {
  const sessionByProviderKey = indexAgentActivitySessions(args.sessions)
  const enabledVaultAgents = new Set(args.enabledVaultAgents)
  const current: AgentActivityItem[] = []
  const completed: AgentActivityItem[] = []

  for (const source of buildAgentActivitySources(args)) {
    const workspace = args.workspaceInfoById.get(source.worktreeId)
    const kind = getCurrentAgentActivityKind(source, args.now)
    if (kind) {
      const item = buildItem({ source, kind, workspace, sessionByProviderKey, filters: args })
      if (visibleInAgentVault({ item, workspace, filters: args, enabledVaultAgents })) {
        current.push(item)
      }
      continue
    }
    if (isNormalAgentCompletion(source.entry) && source.entry.lastAssistantMessage?.trim()) {
      const item = buildItem({
        source,
        kind: 'completed',
        workspace,
        sessionByProviderKey,
        filters: args
      })
      if (visibleInAgentVault({ item, workspace, filters: args, enabledVaultAgents })) {
        completed.push(item)
      }
    }
  }

  const currentAliases = new Set<string>()
  for (const item of current) {
    for (const alias of item.activityIdentity?.aliases ?? []) {
      currentAliases.add(alias)
    }
  }
  const dedupedCompleted = new Map<string, AgentActivityItem>()
  for (const item of completed) {
    const suppressed = [...(item.activityIdentity?.aliases ?? [])].some((alias) =>
      currentAliases.has(alias)
    )
    if (suppressed) {
      continue
    }
    const existing = dedupedCompleted.get(item.id)
    if (!existing || compareItems(item, existing) < 0) {
      dedupedCompleted.set(item.id, item)
    }
  }
  const orderedCurrent = [...current].sort(compareItems)
  const attention = orderedCurrent
    .filter((item) => item.kind === 'attention')
    .sort(compareAttentionItems)
  const working = orderedCurrent.filter((item) => item.kind === 'working')
  const idle = orderedCurrent.filter((item) => item.kind === 'idle')
  const orderedCompleted = [...dedupedCompleted.values()].sort(compareItems)
  return {
    attention,
    working,
    idle,
    completed: orderedCompleted,
    counts: {
      attention: attention.length,
      working: working.length,
      idle: idle.length,
      completed: orderedCompleted.length
    }
  }
}
