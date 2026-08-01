import type { TopLevelView } from '../../../shared/types'

type WorkspaceSurfaceState = {
  activeView: TopLevelView
  setActiveView: (view: TopLevelView) => void
}

/**
 * Activate the workspace surface so editor/browser/terminal content is visible.
 * Keeps the Workflows temporary tab mounted but deactivates it.
 */
export function activateWorkspaceSurface(state: WorkspaceSurfaceState): void {
  if (state.activeView === 'workflows') {
    state.setActiveView('terminal')
  }
}
