import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/ai-vault-resume-target'
import { resolveRuntimePaneTitleLeafId } from '@/lib/runtime-pane-title-leaf-id'
import type { AppState } from '@/store/types'
import {
  toAiVaultAgent,
  type AiVaultAgent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../../../shared/types'

export type AiVaultOriginalPaneTarget = {
  paneKey: string
  worktreeId: string
  tabId: string
  leafId: string
  executionHostId: ExecutionHostId
  normalizedVaultAgent: AiVaultAgent
  providerSessionId: string
}

export type OriginalPaneState = Pick<
  AppState,
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'sleepingAgentSessionsByPaneKey'
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'folderWorkspaces'
  | 'projectGroups'
  | 'repos'
  | 'worktreesByRepo'
>

export function resolveOriginalPaneCandidateExecutionHostId(args: {
  state: OriginalPaneState
  worktreeId: string | null | undefined
  executionHostId?: string
}): string | null {
  if (!args.executionHostId && (!args.state.repos || !args.state.worktreesByRepo)) {
    return null
  }
  return (
    args.executionHostId ??
    getAiVaultResumeWorkspaceExecutionHostId(args.state, args.worktreeId ?? null)
  )
}

export function candidateMatchesSessionHost(args: {
  state: OriginalPaneState
  session: AiVaultSession
  worktreeId: string | null | undefined
  executionHostId?: string
}): boolean {
  return resolveOriginalPaneCandidateExecutionHostId(args) === args.session.executionHostId
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

function hasAvailableLeaf(layout: TerminalLayoutSnapshot | undefined, leafId: string): boolean {
  return layoutHasLeaf(layout?.root, leafId) || Boolean(layout?.ptyIdsByLeafId?.[leafId])
}

function getTabOwnerWorktreeId(
  state: OriginalPaneState,
  tabId: string,
  worktreeIdHint?: string
): string | null {
  if (
    worktreeIdHint &&
    (state.tabsByWorktree[worktreeIdHint] ?? []).some((tab) => tab.id === tabId)
  ) {
    return worktreeIdHint
  }
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

export function resolveOriginalPaneTarget(args: {
  state: OriginalPaneState
  session: AiVaultSession
  paneKey: string
  worktreeIdHint?: string
  tabIdHint?: string
}): AiVaultOriginalPaneTarget | null {
  const { state, session, paneKey, worktreeIdHint, tabIdHint } = args
  const stable = parsePaneKey(paneKey)
  if (stable) {
    if (tabIdHint && tabIdHint !== stable.tabId) {
      return null
    }
    const worktreeId = getTabOwnerWorktreeId(state, stable.tabId, worktreeIdHint)
    if (
      !worktreeId ||
      !hasAvailableLeaf(state.terminalLayoutsByTabId[stable.tabId], stable.leafId)
    ) {
      return null
    }
    return {
      paneKey,
      worktreeId,
      tabId: stable.tabId,
      leafId: stable.leafId,
      executionHostId: session.executionHostId,
      normalizedVaultAgent: session.agent,
      providerSessionId: session.sessionId
    }
  }
  const legacy = parseLegacyNumericPaneKey(paneKey)
  if (!legacy || (tabIdHint && tabIdHint !== legacy.tabId)) {
    return null
  }
  const worktreeId = getTabOwnerWorktreeId(state, legacy.tabId, worktreeIdHint)
  if (!worktreeId) {
    return null
  }
  const layout = state.terminalLayoutsByTabId[legacy.tabId]
  const leafId = resolveRuntimePaneTitleLeafId(layout, legacy.numericPaneId)
  if (!leafId || !hasAvailableLeaf(layout, leafId)) {
    return null
  }
  return {
    paneKey,
    worktreeId,
    tabId: legacy.tabId,
    leafId,
    executionHostId: session.executionHostId,
    normalizedVaultAgent: session.agent,
    providerSessionId: session.sessionId
  }
}

export function paneHasDifferentLiveOccupant(
  state: OriginalPaneState,
  session: AiVaultSession,
  paneKey: string
): boolean {
  const live = state.agentStatusByPaneKey[paneKey]
  if (!live) {
    return false
  }
  return (
    toAiVaultAgent(live.agentType) !== session.agent ||
    live.providerSession?.id !== session.sessionId ||
    !candidateMatchesSessionHost({
      state,
      session,
      worktreeId: live.worktreeId,
      executionHostId: live.executionHostId
    })
  )
}

export function paneHasCurrentLiveAuthority(
  state: OriginalPaneState,
  session: AiVaultSession,
  paneKey: string
): boolean {
  const live = state.agentStatusByPaneKey[paneKey]
  return Boolean(
    live &&
    toAiVaultAgent(live.agentType) === session.agent &&
    live.providerSession?.id === session.sessionId &&
    candidateMatchesSessionHost({
      state,
      session,
      worktreeId: live.worktreeId,
      executionHostId: live.executionHostId
    })
  )
}

export function originalPaneTargetMatchesCurrentAuthority(
  state: OriginalPaneState,
  target: AiVaultOriginalPaneTarget
): boolean {
  if (
    getAiVaultResumeWorkspaceExecutionHostId(state, target.worktreeId) !== target.executionHostId
  ) {
    return false
  }
  if (
    getTabOwnerWorktreeId(state, target.tabId, target.worktreeId) !== target.worktreeId ||
    !hasAvailableLeaf(state.terminalLayoutsByTabId[target.tabId], target.leafId)
  ) {
    return false
  }
  const live = state.agentStatusByPaneKey[target.paneKey]
  return Boolean(
    live &&
    toAiVaultAgent(live.agentType) === target.normalizedVaultAgent &&
    live.providerSession?.id === target.providerSessionId &&
    resolveOriginalPaneCandidateExecutionHostId({
      state,
      worktreeId: live.worktreeId,
      executionHostId: live.executionHostId
    }) === target.executionHostId
  )
}
