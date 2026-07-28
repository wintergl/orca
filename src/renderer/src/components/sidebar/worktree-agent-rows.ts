import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'
import { providerAgentEvidence } from '@/lib/pane-agent-evidence'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry,
  type AgentStatusOrchestrationContext
} from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/types'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'
import type { PaneAgentLifecycle } from '@/store/slices/pane-agent-lifecycle'
import { buildTitleDerivedAgentRows } from './worktree-title-derived-agent-rows'
import { buildSubagentChildRows } from './worktree-subagent-child-rows'
import { compareWorktreeAgentRows } from './worktree-agent-row-order'
import {
  effectiveWorktreeAgentRowStartedAt,
  tabFromWorktreeAttributedStatusEntry
} from './worktree-agent-row-fallback-tab'
import {
  entryWithLifecycle,
  entryWithRuntimeOrchestration,
  resolveWorktreeRowAgentType
} from './worktree-agent-row-status'
import {
  isRetainedLegacyAliasOfSeenStablePane,
  markCompletedWorkerParentPaneKeysSeen
} from './worktree-agent-row-pane-alias'

export function buildWorktreeAgentRows(args: {
  tabs: TerminalTab[]
  entries: AgentStatusEntry[]
  retained: RetainedAgentEntry[]
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  ptyIdsByTabId?: Record<string, string[]>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
  paneForegroundAgentByPaneKey?: Record<string, PaneForegroundAgentEntry | undefined>
  paneAgentLifecycleByPaneKey?: Record<string, PaneAgentLifecycle | undefined>
  now: number
}): DashboardAgentRow[] {
  const rows: DashboardAgentRow[] = []
  const seenPaneKeys = new Set<string>()
  const staleRowsByPaneKey = new Map<
    string,
    { entry: AgentStatusEntry; tab: TerminalTab; startedAt: number }
  >()
  const currentTabIds = new Set(args.tabs.map((tab) => tab.id))

  const entriesByTabId = new Map<string, AgentStatusEntry[]>()
  for (const entry of args.entries) {
    const parsed = parsePaneKey(entry.paneKey)
    if (!parsed) {
      continue
    }
    const bucket = entriesByTabId.get(parsed.tabId)
    if (bucket) {
      bucket.push(entry)
    } else {
      entriesByTabId.set(parsed.tabId, [entry])
    }
  }

  for (const tab of args.tabs) {
    const explicitEntries = entriesByTabId.get(tab.id) ?? []
    for (const entry of explicitEntries) {
      const rowEntry = entryWithLifecycle(
        entryWithRuntimeOrchestration(entry, args.runtimeAgentOrchestrationByPaneKey),
        args.paneAgentLifecycleByPaneKey?.[entry.paneKey]
      )
      const isFresh = isExplicitAgentStatusFresh(rowEntry, args.now, AGENT_STATUS_STALE_AFTER_MS)
      if (!isFresh) {
        staleRowsByPaneKey.set(rowEntry.paneKey, {
          entry: rowEntry,
          tab,
          startedAt: effectiveWorktreeAgentRowStartedAt(rowEntry)
        })
        continue
      }
      const shouldDecay =
        !isFresh &&
        (rowEntry.state === 'working' ||
          rowEntry.state === 'blocked' ||
          rowEntry.state === 'waiting')
      const startedAt = effectiveWorktreeAgentRowStartedAt(rowEntry)
      rows.push({
        paneKey: rowEntry.paneKey,
        entry: rowEntry,
        tab,
        agentType: resolveWorktreeRowAgentType(rowEntry, tab),
        rowSource: 'live',
        ...providerAgentEvidence(isFresh ? 'fresh-hook' : 'stale-hook'),
        state: shouldDecay ? 'idle' : rowEntry.state,
        startedAt
      })
      rows.push(...buildSubagentChildRows({ parentEntry: rowEntry, tab, parentIsFresh: isFresh }))
      seenPaneKeys.add(rowEntry.paneKey)
    }
  }

  markCompletedWorkerParentPaneKeysSeen({
    entries: args.entries.filter((entry) =>
      isExplicitAgentStatusFresh(entry, args.now, AGENT_STATUS_STALE_AFTER_MS)
    ),
    retained: args.retained.filter((entry) =>
      isExplicitAgentStatusFresh(entry.entry, args.now, AGENT_STATUS_STALE_AFTER_MS)
    ),
    runtimeAgentOrchestrationByPaneKey: args.runtimeAgentOrchestrationByPaneKey,
    terminalLayoutsByTabId: args.terminalLayoutsByTabId,
    currentTabIds,
    seenPaneKeys
  })

  const titleRows = buildTitleDerivedAgentRows({ ...args, seenPaneKeys })
  const titlePaneKeys = new Set(titleRows.map((row) => row.paneKey))
  rows.push(
    ...titleRows.map((row) => {
      const stale = staleRowsByPaneKey.get(row.paneKey)
      if (!stale) {
        return row
      }
      const entry = entryWithLifecycle(stale.entry, args.paneAgentLifecycleByPaneKey?.[row.paneKey])
      return {
        ...row,
        entry: {
          ...entry,
          terminalTitle: row.entry.terminalTitle,
          ...(row.entry.agentLifecycleId
            ? {
                executionHostId: row.entry.executionHostId,
                agentLifecycleId: row.entry.agentLifecycleId,
                agentSessionStartedAt: row.entry.agentSessionStartedAt
              }
            : {})
        },
        contentEvidence: 'provider' as const,
        startedAt: stale.startedAt
      }
    })
  )
  for (const [paneKey, stale] of staleRowsByPaneKey) {
    if (titlePaneKeys.has(paneKey)) {
      continue
    }
    if (!args.paneForegroundAgentByPaneKey?.[paneKey]?.agent) {
      continue
    }
    rows.push({
      paneKey,
      entry: stale.entry,
      tab: stale.tab,
      agentType: resolveWorktreeRowAgentType(stale.entry, stale.tab),
      rowSource: 'live',
      ...providerAgentEvidence('stale-hook'),
      state: 'idle',
      startedAt: stale.startedAt
    })
    rows.push(
      ...buildSubagentChildRows({ parentEntry: stale.entry, tab: stale.tab, parentIsFresh: false })
    )
    seenPaneKeys.add(paneKey)
  }
  // Why: orchestration workers can be attributed to a worktree by main before
  // their tab is present in this renderer. Keep those live rows visible in the
  // worktree card instead of waiting for tab membership that may never arrive.
  for (const entry of args.entries) {
    if (seenPaneKeys.has(entry.paneKey)) {
      continue
    }
    const rowEntry = entryWithLifecycle(
      entryWithRuntimeOrchestration(entry, args.runtimeAgentOrchestrationByPaneKey),
      args.paneAgentLifecycleByPaneKey?.[entry.paneKey]
    )
    const startedAt = effectiveWorktreeAgentRowStartedAt(rowEntry)
    const tab = tabFromWorktreeAttributedStatusEntry(rowEntry, startedAt)
    if (!tab) {
      continue
    }
    const isFresh = isExplicitAgentStatusFresh(rowEntry, args.now, AGENT_STATUS_STALE_AFTER_MS)
    const shouldDecay =
      !isFresh &&
      (rowEntry.state === 'working' || rowEntry.state === 'blocked' || rowEntry.state === 'waiting')
    if (!isFresh && !args.paneForegroundAgentByPaneKey?.[rowEntry.paneKey]?.agent) {
      continue
    }
    rows.push({
      paneKey: rowEntry.paneKey,
      entry: rowEntry,
      tab,
      agentType: resolveWorktreeRowAgentType(rowEntry, tab),
      rowSource: 'live',
      ...providerAgentEvidence(isFresh ? 'fresh-hook' : 'stale-hook'),
      state: shouldDecay ? 'idle' : rowEntry.state,
      startedAt
    })
    rows.push(...buildSubagentChildRows({ parentEntry: rowEntry, tab, parentIsFresh: isFresh }))
    seenPaneKeys.add(rowEntry.paneKey)
  }
  for (const ra of args.retained) {
    if (seenPaneKeys.has(ra.entry.paneKey)) {
      continue
    }
    if (
      isRetainedLegacyAliasOfSeenStablePane({
        paneKey: ra.entry.paneKey,
        terminalLayoutsByTabId: args.terminalLayoutsByTabId,
        seenPaneKeys
      })
    ) {
      continue
    }
    const rowEntry = entryWithRuntimeOrchestration(
      ra.entry,
      args.runtimeAgentOrchestrationByPaneKey
    )
    rows.push({
      paneKey: rowEntry.paneKey,
      entry: rowEntry,
      tab: ra.tab,
      agentType: resolveWorktreeRowAgentType(rowEntry, ra.tab),
      rowSource: 'retained',
      ...providerAgentEvidence('retained'),
      state: 'done',
      startedAt: ra.startedAt
    })
  }

  // Why: hook pings can rebuild the live entry list in a different iteration
  // order. Equal-start agents still need a deterministic sidebar order.
  rows.sort(compareWorktreeAgentRows)
  return rows
}
