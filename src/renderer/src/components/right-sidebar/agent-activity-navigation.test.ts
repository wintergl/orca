import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivityItem } from './agent-activity-types'
import { navigateToAgentActivity } from './agent-activity-navigation'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-1:${LEAF_ID}`
const navigationMocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(() => true),
  activateTabAndFocusPane: vi.fn(),
  toastError: vi.fn(),
  setActiveTabType: vi.fn(),
  state: undefined as unknown
}))

vi.mock('sonner', () => ({ toast: { error: navigationMocks.toastError } }))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => navigationMocks.state }
}))

vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: navigationMocks.activateTabAndFocusPane
}))

vi.mock('@/lib/ai-vault-resume-target', () => ({
  getAiVaultResumeWorkspaceExecutionHostId: () => 'local'
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: navigationMocks.activateAndRevealWorktree
}))

function item(providerSessionId: string | null = null): AgentActivityItem {
  return {
    id: 'current:codexdb',
    kind: 'idle',
    state: 'idle',
    paneKey: PANE_KEY,
    worktreeId: 'wt-1',
    executionHostId: 'local',
    runtimeAgent: 'codexdb',
    vaultAgent: 'codex',
    title: 'Doubao Coding',
    subtitle: null,
    message: 'Finished safely.',
    completionMessage: 'Finished safely.',
    toolName: null,
    toolInput: null,
    interactivePrompt: null,
    startedAt: 1,
    stateChangedAt: 2,
    updatedAt: 2,
    completedAt: null,
    providerSessionId,
    agentLifecycleId: 'lifecycle-current',
    agentSessionStartedAt: 1,
    activityIdentity: null,
    matchedSession: null,
    navigationTarget: {
      worktreeId: 'wt-1',
      paneKey: PANE_KEY,
      executionHostId: 'local',
      runtimeAgent: 'codexdb',
      normalizedVaultAgent: 'codex',
      providerSessionId,
      agentLifecycleId: 'lifecycle-current',
      ptyId: 'pty-current',
      activityIdentity: {
        canonicalKey: 'local:wt-1:tab-1:codexdb:lifecycle-current',
        aliases: new Set()
      }
    },
    navigationUnavailableReason: null
  }
}

function state(entryProviderSessionId: string) {
  return {
    worktreesByRepo: { 'repo-1': [{ id: 'wt-1' }] },
    folderWorkspaces: [],
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: 'pty-current' }
      }
    },
    paneAgentLifecycleByPaneKey: {
      [PANE_KEY]: {
        id: 'lifecycle-current',
        startedAt: 1,
        paneKey: PANE_KEY,
        executionHostId: 'local',
        connectionId: null,
        ptyId: 'pty-current',
        runtimeAgent: 'codexdb',
        providerSessionId: null,
        launchToken: null,
        phase: 'active',
        authorityRevision: 2
      }
    },
    agentStatusByPaneKey: {
      [PANE_KEY]: {
        paneKey: PANE_KEY,
        state: 'done',
        prompt: 'Finish safely',
        updatedAt: 1,
        stateStartedAt: 1,
        stateHistory: [],
        agentType: 'codexdb',
        worktreeId: 'wt-1',
        executionHostId: 'local',
        agentLifecycleId: 'lifecycle-previous',
        providerSession: { key: 'session_id', id: entryProviderSessionId }
      }
    },
    setActiveTabType: navigationMocks.setActiveTabType
  }
}

describe('navigateToAgentActivity', () => {
  afterEach(() => {
    navigationMocks.activateAndRevealWorktree.mockClear()
    navigationMocks.activateTabAndFocusPane.mockClear()
    navigationMocks.toastError.mockClear()
    navigationMocks.setActiveTabType.mockClear()
  })

  it('opens a Codex wrapper pane when a predecessor hook has an older lifecycle', () => {
    navigationMocks.state = state('session-previous')

    navigateToAgentActivity(item())

    expect(navigationMocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(navigationMocks.activateTabAndFocusPane).toHaveBeenCalledWith('tab-1', LEAF_ID, {
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
    expect(navigationMocks.toastError).not.toHaveBeenCalled()
  })

  it('rejects a target whose required provider session no longer matches', () => {
    navigationMocks.state = state('session-previous')

    navigateToAgentActivity(item('session-current'))

    expect(navigationMocks.activateAndRevealWorktree).not.toHaveBeenCalled()
    expect(navigationMocks.toastError).toHaveBeenCalledWith('Agent pane is no longer available.')
  })
})
