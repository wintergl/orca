/** Visibility for split-group terminal overlays under workspace / workflows surfaces. */

export function isTerminalOverlayAssignmentVisible(params: {
  isWorktreeActive: boolean
  showWorkspacePanes: boolean
  isActiveInGroup: boolean
}): boolean {
  // Why: workflows keeps worktreeSurfaceLive for light tab hide, but panes stay non-visible.
  return params.isWorktreeActive && params.showWorkspacePanes && params.isActiveInGroup
}

export function shouldShowPresentedTerminalOverlay(params: {
  isPresented: boolean
  isWorktreeActive: boolean
  isWorktreePresented: boolean
  showWorkspacePanes: boolean
}): boolean {
  return (
    params.showWorkspacePanes &&
    params.isPresented &&
    (params.isWorktreeActive || params.isWorktreePresented)
  )
}

export function isTerminalOverlayInteractive(params: {
  isVisible: boolean
  isPresented: boolean
  isWorktreePresented: boolean
  showWorkspacePanes: boolean
}): boolean {
  return (
    params.showWorkspacePanes &&
    params.isVisible &&
    params.isPresented &&
    params.isWorktreePresented
  )
}

export function isTerminalOverlayPaneRendererVisible(params: {
  isVisible: boolean
  showPresentedTerminal: boolean
  hasActivityPortal: boolean
}): boolean {
  return params.isVisible || params.showPresentedTerminal || params.hasActivityPortal
}
