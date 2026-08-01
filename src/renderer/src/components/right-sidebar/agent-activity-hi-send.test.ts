import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivityItem } from './agent-activity-types'
import { sendHiToAgentActivity } from './agent-activity-hi-send'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-2:${LEAF_ID}`
const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  findTerminal: vi.fn(),
  supportsCapability: vi.fn(),
  executionHostId: 'local',
  runtimeTarget: { kind: 'local' } as
    | { kind: 'local' }
    | { kind: 'environment'; environmentId: string },
  state: undefined as unknown
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))

vi.mock('@/lib/ai-vault-resume-target', () => ({
  getAiVaultResumeWorkspaceExecutionHostId: () => mocks.executionHostId
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getSettingsForWorktreeRuntimeOwner: () => ({})
}))

vi.mock('@/lib/active-agent-note-target', () => ({
  findActiveRuntimeTerminal: mocks.findTerminal
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc,
  getActiveRuntimeTarget: () => mocks.runtimeTarget,
  runtimeEnvironmentSupportsCapability: mocks.supportsCapability
}))

function item(overrides: Partial<AgentActivityItem> = {}): AgentActivityItem {
  return {
    id: 'current:codex-2',
    kind: 'idle',
    state: 'idle',
    paneKey: PANE_KEY,
    worktreeId: 'wt-1',
    executionHostId: 'local',
    runtimeAgent: 'codex',
    vaultAgent: 'codex',
    title: 'Codex 2',
    subtitle: null,
    message: 'Ready',
    completionMessage: 'Ready',
    toolName: null,
    toolInput: null,
    interactivePrompt: null,
    startedAt: 1,
    stateChangedAt: 2,
    updatedAt: 2,
    completedAt: null,
    providerSessionId: 'session-2',
    agentLifecycleId: 'lifecycle-2',
    agentSessionStartedAt: 1,
    activityIdentity: null,
    matchedSession: null,
    navigationTarget: {
      worktreeId: 'wt-1',
      paneKey: PANE_KEY,
      executionHostId: 'local',
      runtimeAgent: 'codex',
      normalizedVaultAgent: 'codex',
      providerSessionId: 'session-2',
      agentLifecycleId: 'lifecycle-2',
      ptyId: 'pty-2',
      activityIdentity: { canonicalKey: 'agent-2', aliases: new Set() }
    },
    navigationUnavailableReason: null,
    ...overrides
  }
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    paneAgentLifecycleByPaneKey: {
      [PANE_KEY]: {
        id: 'lifecycle-2',
        executionHostId: 'local',
        phase: 'active',
        ptyId: 'pty-2',
        runtimeAgent: 'codex'
      }
    },
    agentStatusByPaneKey: {
      [PANE_KEY]: {
        executionHostId: 'local',
        agentLifecycleId: 'lifecycle-2',
        providerSession: { id: 'session-2' },
        agentType: 'codex'
      }
    },
    ...overrides
  }
}

describe('sendHiToAgentActivity', () => {
  afterEach(() => {
    mocks.callRuntimeRpc.mockReset()
    mocks.findTerminal.mockReset()
    mocks.supportsCapability.mockReset()
    mocks.executionHostId = 'local'
    mocks.runtimeTarget = { kind: 'local' }
  })

  it('routes fixed lowercase hi only to the clicked Agent terminal', async () => {
    mocks.state = state()
    mocks.findTerminal.mockResolvedValue({
      handle: 'terminal-2',
      ptyId: 'pty-2',
      connected: true,
      writable: true
    })
    mocks.callRuntimeRpc.mockResolvedValue({
      send: { handle: 'terminal-2', accepted: true, bytesWritten: 1 }
    })

    await expect(sendHiToAgentActivity(item())).resolves.toBe('sent')

    expect(mocks.findTerminal).toHaveBeenCalledWith(
      { kind: 'local' },
      'wt-1',
      { tabId: 'tab-2', leafId: LEAF_ID },
      15_000
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(2)
    expect(mocks.callRuntimeRpc.mock.calls[0]?.[2]).toMatchObject({
      terminal: 'terminal-2',
      text: expect.stringContaining('hi'),
      requireAgentStatus: 'idle'
    })
    expect(mocks.callRuntimeRpc.mock.calls[1]?.[2]).toMatchObject({
      terminal: 'terminal-2',
      enter: true,
      requireAgentStatus: 'idle'
    })
  })

  it('rejects a replacement lifecycle before looking up any terminal', async () => {
    mocks.state = state({
      paneAgentLifecycleByPaneKey: {
        [PANE_KEY]: {
          id: 'replacement',
          executionHostId: 'local',
          phase: 'active',
          ptyId: 'pty-3',
          runtimeAgent: 'codex'
        }
      }
    })

    await expect(sendHiToAgentActivity(item())).resolves.toBe('agent-changed')
    expect(mocks.findTerminal).not.toHaveBeenCalled()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('rejects a terminal lookup that resolves to another PTY', async () => {
    mocks.state = state()
    mocks.findTerminal.mockResolvedValue({
      handle: 'terminal-1',
      ptyId: 'pty-1',
      connected: true,
      writable: true
    })

    await expect(sendHiToAgentActivity(item())).resolves.toBe('agent-changed')
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('does not paste when the runtime reports that the Agent is no longer idle', async () => {
    mocks.state = state()
    mocks.findTerminal.mockResolvedValue({
      handle: 'terminal-2',
      ptyId: 'pty-2',
      connected: true,
      writable: true
    })
    mocks.callRuntimeRpc.mockResolvedValue({
      send: {
        handle: 'terminal-2',
        accepted: false,
        bytesWritten: 0,
        refusedReason: 'not-idle'
      }
    })

    await expect(sendHiToAgentActivity(item())).resolves.toBe('not-idle')
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
  })

  it('validates the wrapped terminal handle on a capable Runtime Host', async () => {
    const remoteHost = 'runtime:env-1'
    const remotePtyId = 'remote:env-1@@terminal-2'
    const remoteItem = item()
    remoteItem.executionHostId = remoteHost
    remoteItem.navigationTarget = {
      ...remoteItem.navigationTarget!,
      executionHostId: remoteHost,
      ptyId: remotePtyId
    }
    mocks.executionHostId = remoteHost
    mocks.runtimeTarget = { kind: 'environment', environmentId: 'env-1' }
    mocks.state = state({
      paneAgentLifecycleByPaneKey: {
        [PANE_KEY]: {
          id: 'lifecycle-2',
          executionHostId: remoteHost,
          phase: 'active',
          ptyId: remotePtyId,
          runtimeAgent: 'codex'
        }
      },
      agentStatusByPaneKey: {
        [PANE_KEY]: {
          executionHostId: remoteHost,
          agentLifecycleId: 'lifecycle-2',
          providerSession: { id: 'session-2' },
          agentType: 'codex'
        }
      }
    })
    mocks.supportsCapability.mockResolvedValue(true)
    mocks.findTerminal.mockResolvedValue({
      handle: 'terminal-2',
      ptyId: 'pty-on-host',
      connected: true,
      writable: true
    })
    mocks.callRuntimeRpc.mockResolvedValue({
      send: { handle: 'terminal-2', accepted: true, bytesWritten: 1 }
    })

    await expect(sendHiToAgentActivity(remoteItem)).resolves.toBe('sent')
    expect(mocks.supportsCapability).toHaveBeenCalledWith('env-1', 'terminal.agent-idle-guard.v1')
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(2)
  })

  it('reports an unreachable Runtime Host without attempting a send', async () => {
    const remoteHost = 'runtime:env-1'
    const remoteItem = item()
    remoteItem.executionHostId = remoteHost
    remoteItem.navigationTarget = {
      ...remoteItem.navigationTarget!,
      executionHostId: remoteHost,
      ptyId: 'remote:env-1@@terminal-2'
    }
    mocks.executionHostId = remoteHost
    mocks.runtimeTarget = { kind: 'environment', environmentId: 'env-1' }
    mocks.state = state({
      paneAgentLifecycleByPaneKey: {
        [PANE_KEY]: {
          id: 'lifecycle-2',
          executionHostId: remoteHost,
          phase: 'active',
          ptyId: 'remote:env-1@@terminal-2',
          runtimeAgent: 'codex'
        }
      },
      agentStatusByPaneKey: {
        [PANE_KEY]: {
          executionHostId: remoteHost,
          agentLifecycleId: 'lifecycle-2',
          providerSession: { id: 'session-2' },
          agentType: 'codex'
        }
      }
    })
    mocks.supportsCapability.mockRejectedValue(new Error('offline'))

    await expect(sendHiToAgentActivity(remoteItem)).resolves.toBe('runtime-unavailable')
    expect(mocks.findTerminal).not.toHaveBeenCalled()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
