import { buildWorktreeAgentRows } from '@/components/sidebar/worktree-agent-rows'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TuiAgent } from '../../../../shared/types'
import type {
  AgentActivityKind,
  AgentActivitySource,
  BuildAgentActivityArgs
} from './agent-activity-types'

function isTuiAgent(value: string | undefined): value is TuiAgent {
  return typeof value === 'string' && value in TUI_AGENT_CONFIG
}

function workspaceIdForPaneKey(
  paneKey: string,
  tabsByWorktree: BuildAgentActivityArgs['tabsByWorktree'],
  fallback: string | undefined
): string | null {
  if (fallback) {
    return fallback
  }
  const separator = paneKey.indexOf(':')
  const tabId = separator > 0 ? paneKey.slice(0, separator) : null
  if (!tabId) {
    return null
  }
  for (const [workspaceId, tabs] of Object.entries(tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return workspaceId
    }
  }
  return null
}

function sourceFromRow(
  worktreeId: string,
  row: DashboardAgentRow,
  foreground: AgentActivitySource['foreground'],
  lifecycle: AgentActivitySource['lifecycle']
): AgentActivitySource {
  return {
    paneKey: row.paneKey,
    entry: row.entry,
    worktreeId,
    runtimeAgent: isTuiAgent(row.agentType) ? row.agentType : null,
    rowSource: row.rowSource ?? 'live',
    rowState: row.state,
    presenceEvidence: row.presenceEvidence,
    contentEvidence: row.contentEvidence,
    foreground,
    lifecycle
  }
}

export function buildAgentActivitySources(args: BuildAgentActivityArgs): AgentActivitySource[] {
  const entriesByWorktree = new Map<string, AgentStatusEntry[]>()
  for (const [paneKey, entry] of Object.entries(args.agentStatusByPaneKey)) {
    const worktreeId = workspaceIdForPaneKey(paneKey, args.tabsByWorktree, entry.worktreeId)
    if (!worktreeId) {
      continue
    }
    const entries = entriesByWorktree.get(worktreeId)
    if (entries) {
      entries.push(entry)
    } else {
      entriesByWorktree.set(worktreeId, [entry])
    }
  }
  const retainedByWorktree = new Map<
    string,
    BuildAgentActivityArgs['retainedAgentsByPaneKey'][string][]
  >()
  for (const retained of Object.values(args.retainedAgentsByPaneKey)) {
    const entries = retainedByWorktree.get(retained.worktreeId)
    if (entries) {
      entries.push(retained)
    } else {
      retainedByWorktree.set(retained.worktreeId, [retained])
    }
  }

  const sources: AgentActivitySource[] = []
  for (const workspaceId of args.workspaceInfoById.keys()) {
    const rows = buildWorktreeAgentRows({
      tabs: args.tabsByWorktree[workspaceId] ?? [],
      entries: entriesByWorktree.get(workspaceId) ?? [],
      retained: retainedByWorktree.get(workspaceId) ?? [],
      runtimePaneTitlesByTabId: args.runtimePaneTitlesByTabId,
      ptyIdsByTabId: args.ptyIdsByTabId,
      terminalLayoutsByTabId: args.terminalLayoutsByTabId,
      runtimeAgentOrchestrationByPaneKey: args.runtimeAgentOrchestrationByPaneKey,
      paneForegroundAgentByPaneKey: args.paneForegroundAgentByPaneKey,
      paneAgentLifecycleByPaneKey: args.paneAgentLifecycleByPaneKey,
      now: args.now
    })
    for (const row of rows) {
      sources.push(
        sourceFromRow(
          workspaceId,
          row,
          args.paneForegroundAgentByPaneKey[row.paneKey],
          args.paneAgentLifecycleByPaneKey?.[row.paneKey]
        )
      )
    }
  }
  return sources
}

export function getCurrentAgentActivityKind(source: AgentActivitySource): AgentActivityKind | null {
  if (source.lifecycle?.phase === 'transport-disconnected') {
    return null
  }
  switch (source.rowState) {
    case 'waiting':
    case 'blocked':
      return 'attention'
    case 'working':
      return 'working'
    case 'idle':
      return 'idle'
    case 'done':
      return source.foreground?.agent && !source.foreground.shellForeground ? 'idle' : null
  }
}

export function isNormalAgentCompletion(entry: AgentStatusEntry): boolean {
  return entry.state === 'done' && entry.interrupted !== true
}
