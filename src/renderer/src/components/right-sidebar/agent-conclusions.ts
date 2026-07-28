import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import type {
  AgentStatusEntry,
  AgentType,
  AgentStatusState
} from '../../../../shared/agent-status-types'
import {
  toAiVaultAgent,
  type AiVaultAgent,
  type AiVaultScope,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/types'

const MAX_AGENT_CONCLUSIONS = 3

export type AgentConclusionWorkspaceInfo = {
  id: string
  title: string
  projectKey: string | null
  executionHostId: ExecutionHostId
}

export type AgentConclusionItem = {
  id: string
  paneKey: string | null
  worktreeId: string | null
  runtimeAgent: TuiAgent | null
  vaultAgent: AiVaultAgent | null
  title: string
  subtitle: string | null
  message: string
  completedAt: number
  providerSessionId: string | null
  matchedSession: AiVaultSession | null
}

type ConclusionSource = {
  paneKey: string
  entry: AgentStatusEntry
  worktreeId: string | null
  runtimeAgentType: AgentType | undefined
}

export type BuildAgentConclusionsArgs = {
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey: Record<string, RetainedAgentEntry>
  sessions: readonly AiVaultSession[]
  filteredSessionIds: ReadonlySet<string>
  hasSearchQuery: boolean
  enabledVaultAgents: readonly AiVaultAgent[]
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
  workspaceInfoById: ReadonlyMap<string, AgentConclusionWorkspaceInfo>
}

function isTuiAgent(agent: string | null | undefined): agent is TuiAgent {
  return typeof agent === 'string' && agent in TUI_AGENT_CONFIG
}

function conclusionSourceExecutionHostId(
  source: ConclusionSource,
  workspaceInfo: AgentConclusionWorkspaceInfo | undefined
): ExecutionHostId {
  if (workspaceInfo) {
    return workspaceInfo.executionHostId
  }
  return source.entry.connectionId
    ? toSshExecutionHostId(source.entry.connectionId)
    : LOCAL_EXECUTION_HOST_ID
}

function providerMatchKey(args: {
  executionHostId: ExecutionHostId
  vaultAgent: AiVaultAgent
  providerSessionId: string
}): string {
  return `${args.executionHostId}\u0000${args.vaultAgent}\u0000${args.providerSessionId}`
}

function buildSessionByProviderKey(
  sessions: readonly AiVaultSession[]
): ReadonlyMap<string, AiVaultSession> {
  const result = new Map<string, AiVaultSession>()
  for (const session of sessions) {
    result.set(
      providerMatchKey({
        executionHostId: session.executionHostId,
        vaultAgent: session.agent,
        providerSessionId: session.sessionId
      }),
      session
    )
  }
  return result
}

function matchesUnmappedScope(args: {
  vaultAgent: AiVaultAgent
  executionHostId: ExecutionHostId
  worktreeId: string | null
  workspaceInfo: AgentConclusionWorkspaceInfo | undefined
  enabledVaultAgents: ReadonlySet<AiVaultAgent>
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
}): boolean {
  if (!args.enabledVaultAgents.has(args.vaultAgent)) {
    return false
  }
  if (
    args.executionHostScope !== ALL_EXECUTION_HOSTS_SCOPE &&
    args.executionHostId !== args.executionHostScope
  ) {
    return false
  }
  if (args.vaultScope === 'workspace') {
    return Boolean(args.worktreeId && args.workspaceScopeIds.has(args.worktreeId))
  }
  if (args.vaultScope === 'project') {
    return Boolean(
      args.activeProjectKey &&
      args.workspaceInfo?.projectKey &&
      args.workspaceInfo.projectKey === args.activeProjectKey
    )
  }
  return true
}

function shouldKeepConclusion(args: {
  vaultAgent: AiVaultAgent | null
  matchedSession: AiVaultSession | null
  executionHostId: ExecutionHostId
  worktreeId: string | null
  workspaceInfo: AgentConclusionWorkspaceInfo | undefined
  filteredSessionIds: ReadonlySet<string>
  hasSearchQuery: boolean
  enabledVaultAgents: ReadonlySet<AiVaultAgent>
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
}): boolean {
  if (!args.vaultAgent) {
    return false
  }
  if (args.matchedSession) {
    return args.filteredSessionIds.has(args.matchedSession.id)
  }
  if (args.hasSearchQuery) {
    return false
  }
  return matchesUnmappedScope({
    vaultAgent: args.vaultAgent,
    executionHostId: args.executionHostId,
    worktreeId: args.worktreeId,
    workspaceInfo: args.workspaceInfo,
    enabledVaultAgents: args.enabledVaultAgents,
    vaultScope: args.vaultScope,
    executionHostScope: args.executionHostScope,
    activeProjectKey: args.activeProjectKey,
    workspaceScopeIds: args.workspaceScopeIds
  })
}

function sourceStateIsNormalDone(entry: Pick<AgentStatusEntry, 'state' | 'interrupted'>): boolean {
  return entry.state === ('done' satisfies AgentStatusState) && entry.interrupted !== true
}

function buildConclusionId(args: {
  paneKey: string
  providerSessionId: string | null
  vaultAgent: AiVaultAgent | null
  executionHostId: ExecutionHostId
}): string {
  if (args.providerSessionId && args.vaultAgent) {
    return providerMatchKey({
      executionHostId: args.executionHostId,
      vaultAgent: args.vaultAgent,
      providerSessionId: args.providerSessionId
    })
  }
  return `pane\u0000${args.paneKey}`
}

function toConclusionItem(args: {
  source: ConclusionSource
  sessionByProviderKey: ReadonlyMap<string, AiVaultSession>
  filters: BuildAgentConclusionsArgs
  enabledVaultAgentSet: ReadonlySet<AiVaultAgent>
}): AgentConclusionItem | null {
  const message = args.source.entry.lastAssistantMessage?.trim()
  if (!sourceStateIsNormalDone(args.source.entry) || !message) {
    return null
  }
  const completedAt = args.source.entry.stateStartedAt
  if (!Number.isFinite(completedAt)) {
    return null
  }

  const rawAgent = args.source.runtimeAgentType ?? args.source.entry.agentType
  const runtimeAgent = isTuiAgent(rawAgent) ? rawAgent : null
  const vaultAgent = toAiVaultAgent(rawAgent)
  const workspaceInfo = args.source.worktreeId
    ? args.filters.workspaceInfoById.get(args.source.worktreeId)
    : undefined
  const executionHostId = conclusionSourceExecutionHostId(args.source, workspaceInfo)
  const providerSessionId = args.source.entry.providerSession?.id?.trim() || null
  const matchedSession =
    providerSessionId && vaultAgent
      ? (args.sessionByProviderKey.get(
          providerMatchKey({ executionHostId, vaultAgent, providerSessionId })
        ) ?? null)
      : null

  if (
    !shouldKeepConclusion({
      vaultAgent,
      matchedSession,
      executionHostId,
      worktreeId: args.source.worktreeId,
      workspaceInfo,
      filteredSessionIds: args.filters.filteredSessionIds,
      hasSearchQuery: args.filters.hasSearchQuery,
      enabledVaultAgents: args.enabledVaultAgentSet,
      vaultScope: args.filters.vaultScope,
      executionHostScope: args.filters.executionHostScope,
      activeProjectKey: args.filters.activeProjectKey,
      workspaceScopeIds: args.filters.workspaceScopeIds
    })
  ) {
    return null
  }

  return {
    id: buildConclusionId({
      paneKey: args.source.paneKey,
      providerSessionId,
      vaultAgent,
      executionHostId
    }),
    paneKey: args.source.paneKey,
    worktreeId: args.source.worktreeId,
    runtimeAgent,
    vaultAgent,
    title:
      workspaceInfo?.title ?? matchedSession?.title ?? args.source.entry.terminalTitle ?? 'Agent',
    subtitle: matchedSession?.title ?? args.source.entry.model ?? null,
    message,
    completedAt,
    providerSessionId,
    matchedSession
  }
}

function collectConclusionSources(args: BuildAgentConclusionsArgs): ConclusionSource[] {
  const sources: ConclusionSource[] = []
  for (const [paneKey, entry] of Object.entries(args.agentStatusByPaneKey)) {
    sources.push({
      paneKey,
      entry,
      worktreeId: entry.worktreeId ?? null,
      runtimeAgentType: entry.agentType
    })
  }
  for (const [paneKey, retained] of Object.entries(args.retainedAgentsByPaneKey)) {
    sources.push({
      paneKey,
      entry: retained.entry,
      worktreeId: retained.worktreeId,
      runtimeAgentType: retained.agentType
    })
  }
  return sources
}

export function buildAgentConclusions(args: BuildAgentConclusionsArgs): AgentConclusionItem[] {
  const sessionByProviderKey = buildSessionByProviderKey(args.sessions)
  const enabledVaultAgentSet = new Set(args.enabledVaultAgents)
  const byId = new Map<string, AgentConclusionItem>()

  for (const source of collectConclusionSources(args)) {
    const item = toConclusionItem({
      source,
      sessionByProviderKey,
      filters: args,
      enabledVaultAgentSet
    })
    if (!item) {
      continue
    }
    const existing = byId.get(item.id)
    if (
      !existing ||
      item.completedAt > existing.completedAt ||
      (item.completedAt === existing.completedAt && item.matchedSession && !existing.matchedSession)
    ) {
      byId.set(item.id, item)
    }
  }

  return [...byId.values()]
    .sort((left, right) => right.completedAt - left.completedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_AGENT_CONCLUSIONS)
}
