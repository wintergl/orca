import { describe, expect, it } from 'vitest'
import { createTestStore } from './store-test-helpers'

describe('pane agent lifecycle', () => {
  it('stamps hook status rows with the shared lifecycle identity', () => {
    const store = createTestStore()
    const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'

    store
      .getState()
      .setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'Implement activity view', agentType: 'codex' },
        undefined,
        { updatedAt: 10 },
        undefined,
        {
          providerSession: { key: 'session_id', id: 'session-1' },
          agentLifecycleId: 'agent-lifecycle-main'
        }
      )

    const status = store.getState().agentStatusByPaneKey[paneKey]
    expect(status?.agentLifecycleId).toBe('agent-lifecycle-main')
    expect(status?.agentSessionStartedAt).toBe(10)
    expect(store.getState().paneAgentLifecycleByPaneKey[paneKey]?.id).toBe(status?.agentLifecycleId)
  })

  it('replaces renderer lifecycle state when main observes a new authority', () => {
    const store = createTestStore()
    const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'
    const first = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'local',
      runtimeAgent: 'codex',
      providerSessionId: 'session-1',
      observedLifecycleId: 'agent-lifecycle-first',
      observedAt: 10
    })
    const replacement = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'local',
      runtimeAgent: 'codex',
      providerSessionId: 'session-1',
      observedLifecycleId: 'agent-lifecycle-replacement',
      observedAt: 20
    })

    expect(first?.id).toBe('agent-lifecycle-first')
    expect(replacement?.id).toBe('agent-lifecycle-replacement')
    expect(replacement?.startedAt).toBe(20)
  })

  it('retains one identity for compatible evidence and replaces it after an identity change', () => {
    const store = createTestStore()
    const first = store.getState().observePaneAgentLifecycle({
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      executionHostId: 'local',
      runtimeAgent: 'codex',
      providerSessionId: 'session-1',
      observedAt: 10
    })
    const same = store.getState().observePaneAgentLifecycle({
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      executionHostId: 'local',
      runtimeAgent: 'codex',
      providerSessionId: 'session-1',
      observedAt: 20
    })
    const replaced = store.getState().observePaneAgentLifecycle({
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      executionHostId: 'local',
      runtimeAgent: 'codex',
      providerSessionId: 'session-2',
      observedAt: 30
    })

    expect(first?.id).toBe(same?.id)
    expect(replaced?.id).not.toBe(first?.id)
    expect(replaced?.startedAt).toBe(30)
  })

  it('moves authority to a replacement pane and retires it on shell evidence', () => {
    const store = createTestStore()
    const fromPaneKey = 'tab-1:11111111-1111-4111-8111-111111111111'
    const toPaneKey = 'tab-1:22222222-2222-4222-8222-222222222222'
    const lifecycle = store.getState().observePaneAgentLifecycle({
      paneKey: fromPaneKey,
      executionHostId: 'local',
      ptyId: 'pty-1',
      runtimeAgent: 'claude',
      observedAt: 10
    })

    store.getState().transferPaneAgentLifecycle(fromPaneKey, toPaneKey)
    const moved = store.getState().paneAgentLifecycleByPaneKey[toPaneKey]!
    store.getState().setPaneForegroundAgent(toPaneKey, {
      agent: null,
      shellForeground: true,
      authority: {
        ptyId: 'pty-1',
        lifecycleId: moved.id,
        authorityRevision: moved.authorityRevision
      }
    })

    expect(store.getState().paneAgentLifecycleByPaneKey[fromPaneKey]).toBeUndefined()
    expect(store.getState().paneAgentLifecycleByPaneKey[toPaneKey]).toBeUndefined()
    expect(lifecycle).not.toBeNull()
  })

  it('resets on PTY replacement and only restores an SSH lifecycle with continuous relay authority', () => {
    const store = createTestStore()
    const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'
    const first = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'ssh:host-a',
      connectionId: 'host-a',
      ptyId: 'ssh:host-a@@pty-1',
      runtimeAgent: 'codex',
      providerSessionId: 'session-1',
      observedAt: 10
    })

    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'pty-replaced',
      paneKey,
      executionHostId: 'ssh:host-a',
      connectionId: 'host-a',
      ptyId: 'ssh:host-a@@pty-2',
      runtimeAgent: 'codex',
      observedAt: 20
    })
    const afterReplacement = store.getState().paneAgentLifecycleByPaneKey[paneKey]

    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'transport-disconnected',
      paneKey,
      connectionId: 'host-a',
      authorityLifecycleId: afterReplacement!.id,
      authorityRevision: afterReplacement!.authorityRevision,
      observedAt: 30
    })
    const reattached = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'ssh:host-a',
      connectionId: 'host-a',
      ptyId: 'ssh:host-a@@pty-2',
      runtimeAgent: 'codex',
      observedAt: 40
    })

    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'transport-disconnected',
      paneKey,
      connectionId: 'host-a',
      authorityLifecycleId: reattached!.id,
      authorityRevision: reattached!.authorityRevision,
      observedAt: 50
    })
    const replacedAfterReconnect = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'ssh:host-a',
      connectionId: 'host-a',
      ptyId: 'ssh:host-a@@pty-3',
      runtimeAgent: 'codex',
      observedAt: 60
    })

    expect(afterReplacement?.id).not.toBe(first?.id)
    expect(reattached?.id).toBe(afterReplacement?.id)
    expect(reattached?.phase).toBe('active')
    expect(replacedAfterReconnect?.id).not.toBe(afterReplacement?.id)
  })

  it('keeps lifecycle identity through an inconclusive foreground sample', () => {
    const store = createTestStore()
    const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'
    const lifecycle = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'local',
      ptyId: 'pty-1',
      runtimeAgent: 'codex',
      observedAt: 10
    })

    store.getState().dispatchPaneAgentLifecycleEvent({ type: 'foreground-inconclusive', paneKey })

    expect(store.getState().paneAgentLifecycleByPaneKey[paneKey]?.id).toBe(lifecycle?.id)
  })

  it('rejects late shell and retire callbacks from the authority before a PTY replacement', () => {
    const store = createTestStore()
    const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'
    const first = store.getState().observePaneAgentLifecycle({
      paneKey,
      executionHostId: 'local',
      ptyId: 'pty-1',
      runtimeAgent: 'codex',
      observedAt: 10
    })
    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'pty-replaced',
      paneKey,
      executionHostId: 'local',
      ptyId: 'pty-2',
      runtimeAgent: 'codex',
      authorityRevision: first!.authorityRevision + 1,
      observedAt: 20
    })
    const replacement = store.getState().paneAgentLifecycleByPaneKey[paneKey]!

    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'shell-confirmed',
      paneKey,
      authorityLifecycleId: first!.id,
      authorityRevision: first!.authorityRevision,
      observedAt: 30
    })
    store.getState().dispatchPaneAgentLifecycleEvent({
      type: 'pane-retired',
      paneKey,
      authorityLifecycleId: first!.id,
      authorityRevision: first!.authorityRevision,
      observedAt: 40
    })

    expect(store.getState().paneAgentLifecycleByPaneKey[paneKey]).toBe(replacement)
  })
})
