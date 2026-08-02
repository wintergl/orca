import type { TopLevelView } from '../../../shared/types'

type WorkspaceSurfaceState = {
  activeView: TopLevelView
  setActiveView: (view: TopLevelView) => void
}

/**
 * Shared workspace-content activation (P0-R5/R6/R8).
 * Switches the middle surface from Workflows to workspace so editor/browser/terminal
 * content is visible. Workflows stays mounted via `workflowTabOpen` (not closed here).
 * Kind-agnostic: git worktree and folder workspace share the same path.
 */
export function activateWorkspaceSurface(state: WorkspaceSurfaceState): void {
  if (state.activeView === 'workflows') {
    state.setActiveView('terminal')
  }
}
