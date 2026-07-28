import type { AgentStatusState } from '../../../../shared/agent-status-types'
import {
  toAiVaultAgent,
  type AiVaultAgent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  resolveOriginalPaneCandidateExecutionHostId,
  resolveOriginalPaneTarget,
  paneHasCurrentLiveAuthority,
  type OriginalPaneState,
  type AiVaultOriginalPaneTarget
} from './ai-vault-original-pane'
import { promptsMatchSession } from './ai-vault-original-pane-prompt-match'
import {
  buildAgentActivityProviderAgentKey,
  buildAgentActivityProviderKey
} from './agent-activity-session-index'

type LiveEntry = NonNullable<OriginalPaneState['agentStatusByPaneKey'][string]>
type RetainedEntry = NonNullable<OriginalPaneState['retainedAgentsByPaneKey'][string]>
type SleepingEntry = NonNullable<OriginalPaneState['sleepingAgentSessionsByPaneKey'][string]>

type ProviderIndex<T> = Map<string, T[]>
type AgentIndex<T> = Map<string, T[]>

export type AiVaultOriginalPaneIndex = {
  state: OriginalPaneState
  liveByProvider: ProviderIndex<LiveEntry>
  liveWithoutProviderByAgent: AgentIndex<LiveEntry>
  retainedByProvider: ProviderIndex<RetainedEntry>
  retainedWithoutProviderByAgent: AgentIndex<RetainedEntry>
  sleepingByProvider: ProviderIndex<SleepingEntry>
}

function providerKey(executionHostId: string, agent: AiVaultAgent, sessionId: string): string {
  return buildAgentActivityProviderKey({
    executionHostId: executionHostId as ExecutionHostId,
    vaultAgent: agent,
    providerSessionId: sessionId
  })
}

function agentKey(executionHostId: string, agent: AiVaultAgent): string {
  return buildAgentActivityProviderAgentKey({
    executionHostId: executionHostId as ExecutionHostId,
    vaultAgent: agent
  })
}

function appendToIndex<K, T>(index: Map<K, T[]>, key: K, value: T): void {
  const entries = index.get(key)
  if (entries) {
    entries.push(value)
  } else {
    index.set(key, [value])
  }
}

export function buildAiVaultOriginalPaneIndex(state: OriginalPaneState): AiVaultOriginalPaneIndex {
  const liveByProvider: ProviderIndex<LiveEntry> = new Map()
  const liveWithoutProviderByAgent: AgentIndex<LiveEntry> = new Map()
  const retainedByProvider: ProviderIndex<RetainedEntry> = new Map()
  const retainedWithoutProviderByAgent: AgentIndex<RetainedEntry> = new Map()
  const sleepingByProvider: ProviderIndex<SleepingEntry> = new Map()

  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    const agent = toAiVaultAgent(entry?.agentType)
    const executionHostId = entry
      ? resolveOriginalPaneCandidateExecutionHostId({
          state,
          worktreeId: entry.worktreeId,
          executionHostId: entry.executionHostId
        })
      : null
    if (!agent || !executionHostId) {
      continue
    }
    if (entry.providerSession) {
      appendToIndex(
        liveByProvider,
        providerKey(executionHostId, agent, entry.providerSession.id),
        entry
      )
    } else if (entry.providerSession === undefined) {
      appendToIndex(liveWithoutProviderByAgent, agentKey(executionHostId, agent), entry)
    }
  }
  for (const retained of Object.values(state.retainedAgentsByPaneKey)) {
    const agent = toAiVaultAgent(retained?.agentType)
    const executionHostId = retained
      ? resolveOriginalPaneCandidateExecutionHostId({
          state,
          worktreeId: retained.worktreeId,
          executionHostId: retained.entry.executionHostId
        })
      : null
    if (!agent || !executionHostId) {
      continue
    }
    if (retained.entry.providerSession) {
      appendToIndex(
        retainedByProvider,
        providerKey(executionHostId, agent, retained.entry.providerSession.id),
        retained
      )
    } else if (retained.entry.providerSession === undefined) {
      appendToIndex(retainedWithoutProviderByAgent, agentKey(executionHostId, agent), retained)
    }
  }
  for (const record of Object.values(state.sleepingAgentSessionsByPaneKey)) {
    const agent = toAiVaultAgent(record?.agent)
    const executionHostId = record
      ? resolveOriginalPaneCandidateExecutionHostId({ state, worktreeId: record.worktreeId })
      : null
    if (record && agent && executionHostId) {
      appendToIndex(
        sleepingByProvider,
        providerKey(executionHostId, agent, record.providerSession.id),
        record
      )
    }
  }

  return {
    state,
    liveByProvider,
    liveWithoutProviderByAgent,
    retainedByProvider,
    retainedWithoutProviderByAgent,
    sleepingByProvider
  }
}

export function createLazyAiVaultOriginalPaneIndex(
  state: OriginalPaneState
): () => AiVaultOriginalPaneIndex {
  let index: AiVaultOriginalPaneIndex | null = null
  return () => {
    index ??= buildAiVaultOriginalPaneIndex(state)
    return index
  }
}

export function findOriginalAiVaultSessionPaneInIndex(
  index: AiVaultOriginalPaneIndex,
  session: AiVaultSession
): AiVaultOriginalPaneTarget | null {
  const key = providerKey(session.executionHostId, session.agent, session.sessionId)
  const sessionAgentKey = agentKey(session.executionHostId, session.agent)
  const promptMatchedTargets: AiVaultOriginalPaneTarget[] = []

  for (const entry of index.liveByProvider.get(key) ?? []) {
    const target = resolveOriginalPaneTarget({
      state: index.state,
      session,
      paneKey: entry.paneKey,
      worktreeIdHint: entry.worktreeId,
      tabIdHint: entry.tabId
    })
    if (target) {
      return target
    }
  }
  for (const entry of index.liveWithoutProviderByAgent.get(sessionAgentKey) ?? []) {
    if (!promptsMatchSession(session, entry)) {
      continue
    }
    const target = resolveOriginalPaneTarget({
      state: index.state,
      session,
      paneKey: entry.paneKey,
      worktreeIdHint: entry.worktreeId,
      tabIdHint: entry.tabId
    })
    if (target) {
      promptMatchedTargets.push(target)
    }
  }
  for (const retained of index.retainedByProvider.get(key) ?? []) {
    if (!paneHasCurrentLiveAuthority(index.state, session, retained.entry.paneKey)) {
      continue
    }
    const target = resolveOriginalPaneTarget({
      state: index.state,
      session,
      paneKey: retained.entry.paneKey,
      worktreeIdHint: retained.worktreeId,
      tabIdHint: retained.entry.tabId ?? retained.tab.id
    })
    if (target) {
      return target
    }
  }
  for (const retained of index.retainedWithoutProviderByAgent.get(sessionAgentKey) ?? []) {
    if (!promptsMatchSession(session, retained.entry)) {
      continue
    }
    if (!paneHasCurrentLiveAuthority(index.state, session, retained.entry.paneKey)) {
      continue
    }
    const target = resolveOriginalPaneTarget({
      state: index.state,
      session,
      paneKey: retained.entry.paneKey,
      worktreeIdHint: retained.worktreeId,
      tabIdHint: retained.entry.tabId ?? retained.tab.id
    })
    if (target) {
      promptMatchedTargets.push(target)
    }
  }
  for (const record of index.sleepingByProvider.get(key) ?? []) {
    if (!paneHasCurrentLiveAuthority(index.state, session, record.paneKey)) {
      continue
    }
    const target = resolveOriginalPaneTarget({
      state: index.state,
      session,
      paneKey: record.paneKey,
      worktreeIdHint: record.worktreeId,
      tabIdHint: record.tabId
    })
    if (target) {
      return target
    }
  }

  return promptMatchedTargets.length === 1 ? promptMatchedTargets[0] : null
}

export function findAiVaultSessionLiveStateInIndex(
  index: AiVaultOriginalPaneIndex,
  session: AiVaultSession
): AgentStatusState | null {
  const direct = index.liveByProvider.get(
    providerKey(session.executionHostId, session.agent, session.sessionId)
  )
  if (direct?.[0]) {
    return direct[0].state
  }
  const promptMatchedStates: AgentStatusState[] = []
  for (const entry of index.liveWithoutProviderByAgent.get(
    agentKey(session.executionHostId, session.agent)
  ) ?? []) {
    if (promptsMatchSession(session, entry)) {
      promptMatchedStates.push(entry.state)
    }
  }
  return promptMatchedStates.length === 1 ? promptMatchedStates[0] : null
}
