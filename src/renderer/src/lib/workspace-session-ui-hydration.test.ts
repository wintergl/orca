import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../../shared/types'
import { hydrateWorkspaceSessionUiState } from './workspace-session-ui-hydration'

function makeSession(): WorkspaceSessionState {
  return {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {}
  }
}

function makeActions() {
  const calls: string[] = []
  return {
    calls,
    actions: {
      hydrateWorkspaceSession: vi.fn(() => calls.push('workspace')),
      hydrateTabsSession: vi.fn(() => calls.push('tabs')),
      hydrateEditorSession: vi.fn(() => calls.push('editor')),
      hydrateBrowserSession: vi.fn(() => calls.push('browser')),
      setWorkspaceSessionUiReady: vi.fn(() => calls.push('ready'))
    }
  }
}

describe('hydrateWorkspaceSessionUiState', () => {
  it('unlocks workspace interaction only after every UI session store is hydrated', () => {
    const { actions, calls } = makeActions()

    hydrateWorkspaceSessionUiState({
      actions,
      session: makeSession(),
      options: {},
      runtimeHostIdByWorkspaceSessionKey: {}
    })

    expect(calls).toEqual(['workspace', 'tabs', 'editor', 'browser', 'ready'])
    expect(actions.setWorkspaceSessionUiReady).toHaveBeenCalledWith(true)
  })

  it('keeps workspace interaction gated when hydration throws', () => {
    const { actions } = makeActions()
    actions.hydrateEditorSession.mockImplementation(() => {
      throw new Error('editor hydration failed')
    })

    expect(() =>
      hydrateWorkspaceSessionUiState({
        actions,
        session: makeSession(),
        options: {},
        runtimeHostIdByWorkspaceSessionKey: {}
      })
    ).toThrow('editor hydration failed')
    expect(actions.hydrateBrowserSession).not.toHaveBeenCalled()
    expect(actions.setWorkspaceSessionUiReady).not.toHaveBeenCalled()
  })
})
