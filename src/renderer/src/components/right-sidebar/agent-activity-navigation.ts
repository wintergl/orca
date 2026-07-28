import { toast } from 'sonner'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/ai-vault-resume-target'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { toAiVaultAgent } from '../../../../shared/ai-vault-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalPaneLayoutNode } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { classifyTitleActivity } from '@/lib/pane-agent-evidence'
import { resolveRuntimePaneTitleForLeaf } from '@/lib/runtime-pane-title-leaf-id'
import type { AgentActivityItem } from './agent-activity-model'

function workspaceExists(
  state: ReturnType<typeof useAppStore.getState>,
  worktreeId: string
): boolean {
  if (
    Object.values(state.worktreesByRepo).some((worktrees) =>
      worktrees.some((worktree) => worktree.id === worktreeId)
    )
  ) {
    return true
  }
  return state.folderWorkspaces.some((workspace) => folderWorkspaceKey(workspace.id) === worktreeId)
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

export function navigateToAgentActivity(item: AgentActivityItem): void {
  const target = item.navigationTarget
  if (!target) {
    return
  }
  const state = useAppStore.getState()
  const unavailable = () =>
    toast.error(
      translate(
        'auto.components.right.sidebar.AgentActivityBox.agentUnavailable',
        'Agent pane is no longer available.'
      )
    )
  if (!workspaceExists(state, target.worktreeId)) {
    unavailable()
    return
  }
  if (
    getAiVaultResumeWorkspaceExecutionHostId(state, target.worktreeId) !== target.executionHostId
  ) {
    unavailable()
    return
  }
  const parsed = parsePaneKey(target.paneKey)
  if (!parsed) {
    unavailable()
    return
  }
  const tabs = state.tabsByWorktree[target.worktreeId] ?? []
  if (!tabs.some((tab) => tab.id === parsed.tabId)) {
    unavailable()
    return
  }
  const layout = state.terminalLayoutsByTabId[parsed.tabId]
  if (!layoutHasLeaf(layout?.root, parsed.leafId)) {
    unavailable()
    return
  }
  const lifecycle = state.paneAgentLifecycleByPaneKey[target.paneKey]
  if (
    !lifecycle ||
    lifecycle.id !== target.agentLifecycleId ||
    lifecycle.executionHostId !== target.executionHostId ||
    lifecycle.phase !== 'active' ||
    toAiVaultAgent(lifecycle.runtimeAgent) !== target.normalizedVaultAgent
  ) {
    unavailable()
    return
  }
  const entry = state.agentStatusByPaneKey[target.paneKey]
  // Why: replacement lifecycles can outlive their predecessor hook until its next heartbeat.
  if (target.providerSessionId) {
    if (
      !entry ||
      entry.executionHostId !== target.executionHostId ||
      toAiVaultAgent(entry.agentType) !== target.normalizedVaultAgent ||
      entry.providerSession?.id !== target.providerSessionId ||
      entry.agentLifecycleId !== target.agentLifecycleId
    ) {
      unavailable()
      return
    }
  }
  if (!entry) {
    const title = resolveRuntimePaneTitleForLeaf(
      layout,
      state.runtimePaneTitlesByTabId[parsed.tabId],
      parsed.leafId
    )
    const liveTitle =
      Boolean(title && classifyTitleActivity(title)) &&
      Boolean(
        layout?.ptyIdsByLeafId?.[parsed.leafId] &&
        state.ptyIdsByTabId[parsed.tabId]?.includes(layout.ptyIdsByLeafId[parsed.leafId]!)
      )
    const foreground = state.paneForegroundAgentByPaneKey[target.paneKey]
    if (!liveTitle && !(foreground?.agent && !foreground.shellForeground)) {
      unavailable()
      return
    }
  }
  if (!activateAndRevealWorktree(target.worktreeId)) {
    unavailable()
    return
  }
  state.setActiveTabType('terminal')
  activateTabAndFocusPane(parsed.tabId, parsed.leafId, {
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
}
