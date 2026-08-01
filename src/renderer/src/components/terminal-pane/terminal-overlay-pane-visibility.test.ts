import { describe, expect, it } from 'vitest'
import {
  isTerminalOverlayAssignmentVisible,
  isTerminalOverlayInteractive,
  isTerminalOverlayPaneRendererVisible,
  shouldShowPresentedTerminalOverlay
} from './terminal-overlay-pane-visibility'

describe('terminal overlay pane visibility under workflows', () => {
  it('hides assignment visibility when workspace panes are covered', () => {
    expect(
      isTerminalOverlayAssignmentVisible({
        isWorktreeActive: true,
        showWorkspacePanes: false,
        isActiveInGroup: true
      })
    ).toBe(false)
    expect(
      isTerminalOverlayAssignmentVisible({
        isWorktreeActive: true,
        showWorkspacePanes: true,
        isActiveInGroup: true
      })
    ).toBe(true)
  })

  it('does not present terminals while workflows covers the worktree', () => {
    expect(
      shouldShowPresentedTerminalOverlay({
        isPresented: true,
        isWorktreeActive: true,
        isWorktreePresented: true,
        showWorkspacePanes: false
      })
    ).toBe(false)
    expect(
      shouldShowPresentedTerminalOverlay({
        isPresented: true,
        isWorktreeActive: true,
        isWorktreePresented: true,
        showWorkspacePanes: true
      })
    ).toBe(true)
  })

  it('keeps renderer visibility false when only a presented terminal would show under workflows', () => {
    expect(
      isTerminalOverlayPaneRendererVisible({
        isVisible: false,
        showPresentedTerminal: false,
        hasActivityPortal: false
      })
    ).toBe(false)
    expect(
      isTerminalOverlayInteractive({
        isVisible: true,
        isPresented: true,
        isWorktreePresented: true,
        showWorkspacePanes: false
      })
    ).toBe(false)
  })
})
