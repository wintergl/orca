import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { TuiAgent } from '../../../../shared/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/ai-vault-resume-target'

export type PaneForegroundAgentEntry = {
  /** Recognized agent process in the pane's foreground; null when unknown. */
  agent: TuiAgent | null
  /** True only when fresh provider evidence is safe for input-byte routing. */
  routingTrusted?: boolean
  /** True once the foreground is proven back at the shell (OSC 133;D) —
   *  process-grade launched-agent exit evidence, independent of titles. */
  shellForeground: boolean
  /** PTY/lifecycle captured when the foreground sample was taken. */
  authority?: PaneForegroundAgentAuthority
}

export type PaneForegroundAgentAuthority = {
  ptyId: string
  lifecycleId: string
  authorityRevision: number
}

/** Provenance supplied by a PTY-bound teardown callback. */
export type PaneForegroundAgentClearAuthority = {
  ptyId: string
}

/**
 * Process-table identity for local panes, read at OSC 133 command boundaries
 * (see pane-foreground-agent-tracker). Sits below hook rows in the tab-icon
 * resolution; covers agents that emit neither hooks nor titles.
 */
export type PaneForegroundAgentSlice = {
  paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
  setPaneForegroundAgent: (paneKey: string, entry: PaneForegroundAgentEntry) => void
  clearPaneForegroundAgent: (paneKey: string, authority?: PaneForegroundAgentClearAuthority) => void
  /** Wholesale teardown sweeps (tab close, worktree sleep/remove) retire pane
   *  keys without per-pane close events — clear their entries too. */
  clearPaneForegroundAgentByTabPrefix: (tabIdPrefix: string) => void
  clearPaneForegroundAgentByWorktree: (worktreeId: string) => void
}

function foregroundLifecycleAuthority(state: AppState, paneKey: string) {
  const pane = parsePaneKey(paneKey)
  const status = state.agentStatusByPaneKey[paneKey]
  if (!pane) {
    return null
  }
  const worktreeId = Object.entries(state.tabsByWorktree).find(([, tabs]) =>
    tabs.some((tab) => tab.id === pane.tabId)
  )?.[0]
  const executionHostId =
    status?.executionHostId ??
    getAiVaultResumeWorkspaceExecutionHostId(state, worktreeId ?? null) ??
    LOCAL_EXECUTION_HOST_ID
  return {
    executionHostId,
    connectionId: status?.connectionId ?? null,
    ptyId: state.terminalLayoutsByTabId[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId] ?? null,
    providerSessionId: status?.providerSession?.id ?? null,
    launchToken: null
  }
}

function foregroundEntryAuthorityMatches(
  state: AppState,
  paneKey: string,
  authority: PaneForegroundAgentAuthority
): boolean {
  const lifecycle = state.paneAgentLifecycleByPaneKey[paneKey]
  const boundPtyId = lifecycle?.ptyId ?? foregroundLifecycleAuthority(state, paneKey)?.ptyId
  if (!boundPtyId || authority.ptyId !== boundPtyId) {
    return false
  }
  return (
    lifecycle?.id === authority.lifecycleId &&
    lifecycle.authorityRevision === authority.authorityRevision
  )
}

function foregroundEntriesEqual(
  left: PaneForegroundAgentEntry,
  right: PaneForegroundAgentEntry
): boolean {
  return (
    left.agent === right.agent &&
    left.routingTrusted === right.routingTrusted &&
    left.shellForeground === right.shellForeground &&
    left.authority?.ptyId === right.authority?.ptyId &&
    left.authority?.lifecycleId === right.authority?.lifecycleId &&
    left.authority?.authorityRevision === right.authority?.authorityRevision
  )
}

export const createPaneForegroundAgentSlice: StateCreator<
  AppState,
  [],
  [],
  PaneForegroundAgentSlice
> = (set, get) => ({
  paneForegroundAgentByPaneKey: {},
  setPaneForegroundAgent: (paneKey, entry) => {
    const stateBeforeUpdate = get()
    const lifecycle = stateBeforeUpdate.paneAgentLifecycleByPaneKey[paneKey]
    const hasMatchingAuthority = entry.authority
      ? foregroundEntryAuthorityMatches(stateBeforeUpdate, paneKey, entry.authority)
      : false
    // Why: a shell result is destructive lifecycle evidence, so an unbound
    // tracker callback cannot prove it belongs to the currently active PTY.
    if (
      (entry.authority && !hasMatchingAuthority) ||
      (entry.shellForeground && !hasMatchingAuthority)
    ) {
      return
    }
    set((s) => {
      const current = s.paneForegroundAgentByPaneKey[paneKey]
      if (current && foregroundEntriesEqual(current, entry)) {
        return s
      }
      return {
        paneForegroundAgentByPaneKey: { ...s.paneForegroundAgentByPaneKey, [paneKey]: entry }
      }
    })
    if (entry.shellForeground) {
      if (lifecycle && entry.authority) {
        get().dispatchPaneAgentLifecycleEvent({
          type: 'shell-confirmed',
          paneKey,
          authorityLifecycleId: entry.authority.lifecycleId,
          authorityRevision: entry.authority.authorityRevision,
          observedAt: Date.now()
        })
      }
      return
    }
    if (entry.agent) {
      const authority =
        lifecycle && entry.authority ? lifecycle : foregroundLifecycleAuthority(get(), paneKey)
      if (authority) {
        get().dispatchPaneAgentLifecycleEvent({
          type: 'foreground-agent-observed',
          paneKey,
          executionHostId: authority.executionHostId,
          connectionId: authority.connectionId,
          ptyId: authority.ptyId,
          providerSessionId: authority.providerSessionId,
          launchToken: authority.launchToken,
          runtimeAgent: entry.agent,
          observedAt: get().agentStatusByPaneKey[paneKey]?.updatedAt,
          ...(entry.authority
            ? {
                authorityLifecycleId: entry.authority.lifecycleId,
                authorityRevision: entry.authority.authorityRevision
              }
            : {})
        })
      }
    } else {
      get().dispatchPaneAgentLifecycleEvent({ type: 'foreground-inconclusive', paneKey })
    }
  },
  clearPaneForegroundAgent: (paneKey, authority) => {
    const lifecycle = get().paneAgentLifecycleByPaneKey[paneKey]
    // Why: a delayed exit from a replaced PTY must not clear the replacement's
    // foreground evidence or retire its lifecycle.
    if (authority && lifecycle?.ptyId !== authority.ptyId) {
      return
    }
    set((s) => {
      if (!(paneKey in s.paneForegroundAgentByPaneKey)) {
        return s
      }
      const next = { ...s.paneForegroundAgentByPaneKey }
      delete next[paneKey]
      return { paneForegroundAgentByPaneKey: next }
    })
    if (!(paneKey in get().agentStatusByPaneKey) && lifecycle) {
      get().dispatchPaneAgentLifecycleEvent({
        type: 'pane-retired',
        paneKey,
        authorityLifecycleId: lifecycle.id,
        authorityRevision: lifecycle.authorityRevision,
        observedAt: Date.now()
      })
    }
  },
  clearPaneForegroundAgentByTabPrefix: (tabIdPrefix) => {
    set((s) => clearEntriesByTabPrefixes(s.paneForegroundAgentByPaneKey, [`${tabIdPrefix}:`]) ?? s)
    get().clearPaneAgentLifecyclesByTabPrefix(tabIdPrefix)
  },
  clearPaneForegroundAgentByWorktree: (worktreeId) => {
    // Why: entries carry no worktreeId, so this must run while the worktree's
    // tabs are still in tabsByWorktree (removeWorktree prunes them only after
    // awaiting terminal teardown).
    const tabIds = (get().tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
    set((s) => {
      const prefixes = tabIds.map((tabId) => `${tabId}:`)
      return clearEntriesByTabPrefixes(s.paneForegroundAgentByPaneKey, prefixes) ?? s
    })
    for (const tabId of tabIds) {
      get().clearPaneAgentLifecyclesByTabPrefix(tabId)
    }
  }
})

function clearEntriesByTabPrefixes(
  entries: Record<string, PaneForegroundAgentEntry>,
  tabPrefixes: string[]
): Pick<PaneForegroundAgentSlice, 'paneForegroundAgentByPaneKey'> | null {
  if (tabPrefixes.length === 0) {
    return null
  }
  const staleKeys = Object.keys(entries).filter((paneKey) =>
    tabPrefixes.some((prefix) => paneKey.startsWith(prefix))
  )
  if (staleKeys.length === 0) {
    return null
  }
  const next = { ...entries }
  for (const paneKey of staleKeys) {
    delete next[paneKey]
  }
  return { paneForegroundAgentByPaneKey: next }
}
