import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup, TerminalTab } from '../../../../shared/types'
import { useAppStore } from '../../store'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from '../activity/activity-terminal-portal'
import { shouldMountBackgroundWorktreeTab } from '../terminal/background-terminal-worktree-mount'
import { useNativeChatToggleShortcut } from '../native-chat/use-native-chat-toggle-shortcut'
import { useTerminalTabColdParking } from './use-terminal-tab-cold-parking'
import { useTerminalOverlayPresentation } from './use-terminal-overlay-presentation'
import { buildTerminalOverlayAssignments } from './terminal-overlay-assignments'
import { isTerminalOverlayAssignmentVisible } from './terminal-overlay-pane-visibility'
import { TerminalOverlaySlot } from './terminal-overlay-slot'

const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = []
const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []
const EMPTY_ACTIVITY_PORTALS: ActivityTerminalPortalTarget[] = []

const TerminalPaneOverlayLayer = memo(function TerminalPaneOverlayLayer({
  worktreeId,
  worktreePath,
  isWorktreeActive,
  isWorktreePresented = isWorktreeActive,
  showWorkspacePanes = true,
  coldParkTerminalPanes = false,
  shouldMeasureHiddenWorktree = false,
  activityTerminalPortals = EMPTY_ACTIVITY_PORTALS,
  backgroundMountTabIds = null,
  activationDeferredMountTabIds = null,
  onInitialTerminalRenderSettled
}: {
  worktreeId: string
  worktreePath: string
  isWorktreeActive: boolean
  isWorktreePresented?: boolean
  /** False when Workflows overlays the worktree — panes stay tab-hidden. */
  showWorkspacePanes?: boolean
  coldParkTerminalPanes?: boolean
  shouldMeasureHiddenWorktree?: boolean
  activityTerminalPortals?: ActivityTerminalPortalTarget[]
  backgroundMountTabIds?: ReadonlySet<string> | null
  activationDeferredMountTabIds?: ReadonlySet<string> | null
  onInitialTerminalRenderSettled?: (tabId: string) => void
}): React.JSX.Element | null {
  const { terminalTabs, unifiedTabs, groups, activeGroupId } = useAppStore(
    useShallow((state) => ({
      terminalTabs: state.tabsByWorktree[worktreeId] ?? EMPTY_TERMINAL_TABS,
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
      activeGroupId: state.activeGroupIdByWorktree[worktreeId]
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const consumeSuppressedPtyExit = useAppStore((state) => state.consumeSuppressedPtyExit)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const reconcileWorktreeTabModel = useAppStore((state) => state.reconcileWorktreeTabModel)

  useNativeChatToggleShortcut(worktreeId, isWorktreeActive)

  // Why: leave the worktree only after a guarded close resolves empty.
  const leaveWorktreeIfEmpty = useCallback(() => {
    const state = useAppStore.getState()
    if (state.activeWorktreeId !== worktreeId) {
      return
    }
    const { renderableTabCount } = reconcileWorktreeTabModel(worktreeId)
    if (renderableTabCount === 0) {
      setActiveWorktree(null)
    }
  }, [reconcileWorktreeTabModel, setActiveWorktree, worktreeId])

  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )

  const assignments = useMemo(
    () => buildTerminalOverlayAssignments(groups, unifiedTabs),
    [groups, unifiedTabs]
  )

  const { parkedTerminalTabIds, coldParkedTerminalTabIds } = useTerminalTabColdParking({
    worktreeId,
    terminalTabs,
    assignments,
    isWorktreeActive,
    coldParkTerminalPanes,
    shouldMeasureHiddenWorktree,
    activityTerminalPortals,
    activationDeferredMountTabIds
  })
  const { presentedTerminalTabIdByGroup: presentationByScope, handleInitialRenderSettled } =
    useTerminalOverlayPresentation({
      groups,
      terminalTabs,
      assignments,
      coldParkedTerminalTabIds,
      isWorktreeActive,
      activeGroupId,
      onInitialTerminalRenderSettled
    })

  if (!worktreePath) {
    return null
  }

  return (
    <>
      {terminalTabs
        .filter((terminalTab) =>
          shouldMountBackgroundWorktreeTab(backgroundMountTabIds, terminalTab.id)
        )
        .map((terminalTab) => {
          const assignment = assignments.get(terminalTab.id)
          const isVisible = isTerminalOverlayAssignmentVisible({
            isWorktreeActive,
            showWorkspacePanes,
            isActiveInGroup: Boolean(assignment?.isActiveInGroup)
          })
          const isActive = Boolean(isVisible && assignment && assignment.groupId === activeGroupId)
          const isPresented = Boolean(
            assignment && presentationByScope.get(assignment.groupId) === terminalTab.id
          )
          const activityTerminalPortal = findActivityTerminalPortal(activityTerminalPortals, {
            worktreeId,
            tabId: terminalTab.id
          })
          if (parkedTerminalTabIds.has(terminalTab.id)) {
            return null
          }
          return (
            <TerminalOverlaySlot
              key={terminalTab.id}
              terminalTabId={terminalTab.id}
              terminalGeneration={terminalTab.generation}
              worktreeId={worktreeId}
              worktreePath={worktreePath}
              startupCwd={terminalTab.startupCwd}
              groupId={assignment?.groupId}
              isWorktreeActive={isWorktreeActive}
              isWorktreePresented={isWorktreePresented}
              showWorkspacePanes={showWorkspacePanes}
              isVisible={isVisible}
              isPresented={isPresented}
              isActive={isActive}
              activityTerminalPortal={activityTerminalPortal}
              onFocusOwningGroup={focusOwningGroup}
              consumeSuppressedPtyExit={consumeSuppressedPtyExit}
              leaveWorktreeIfEmpty={leaveWorktreeIfEmpty}
              onInitialRenderSettled={() => handleInitialRenderSettled(terminalTab.id)}
            />
          )
        })}
    </>
  )
})

export default TerminalPaneOverlayLayer
