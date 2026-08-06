import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { ALL_EXECUTION_HOSTS_SCOPE } from '../../../../shared/execution-host'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/types'
import { buildAgentActivity, type BuildAgentActivityArgs } from './agent-activity-model'

const NOW = 1_700_000_000_000
const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

function tab(id: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'wt-1',
    title: 'Codex',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    launchAgent: 'codex'
  }
}

function layout(leafId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: 'pty-1' }
  }
}

function entry(paneKey: string, overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    prompt: 'Implement activity view',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'codex',
    worktreeId: 'wt-1',
    executionHostId: 'local',
    ...overrides
  }
}

function baseArgs(overrides: Partial<BuildAgentActivityArgs> = {}): BuildAgentActivityArgs {
  return {
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    paneForegroundAgentByPaneKey: {},
    tabsByWorktree: { 'wt-1': [tab('tab-1')] },
    runtimePaneTitlesByTabId: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    sessions: [],
    filteredSessionIds: new Set(),
    hasSearchQuery: false,
    enabledVaultAgents: ['codex'],
    vaultScope: 'all',
    executionHostScope: ALL_EXECUTION_HOSTS_SCOPE,
    activeProjectKey: null,
    workspaceScopeIds: new Set(['wt-1']),
    workspaceInfoById: new Map([
      ['wt-1', { id: 'wt-1', title: 'Feature branch', projectKey: null, executionHostId: 'local' }]
    ]),
    generatedTitlesEnabled: false,
    now: NOW,
    ...overrides
  }
}

describe('buildAgentActivity', () => {
  it('shows live title evidence as current work without synthetic completion content', () => {
    const model = buildAgentActivity(
      baseArgs({
        runtimePaneTitlesByTabId: { 'tab-1': { 1: '⠋ Codex' } },
        ptyIdsByTabId: { 'tab-1': ['pty-1'] },
        terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) }
      })
    )

    expect(model.counts.working).toBe(1)
    expect(model.working[0]).toMatchObject({
      paneKey: `tab-1:${LEAF_1}`,
      message: null,
      navigationTarget: null
    })
  })

  it('treats a completed turn in the current Agent lifecycle as idle', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const lifecycle = {
      id: 'lifecycle-1',
      startedAt: NOW - 1,
      paneKey,
      executionHostId: 'local' as const,
      connectionId: null,
      ptyId: 'pty-1',
      runtimeAgent: 'codex' as const,
      providerSessionId: null,
      launchToken: null,
      phase: 'active' as const,
      authorityRevision: 1
    }
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [paneKey]: entry(paneKey, {
            state: 'done',
            lastAssistantMessage: 'Finished.',
            agentLifecycleId: lifecycle.id
          })
        },
        paneAgentLifecycleByPaneKey: { [paneKey]: lifecycle },
        terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) }
      })
    )
    const working = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [paneKey]: entry(paneKey, { agentLifecycleId: lifecycle.id })
        },
        paneAgentLifecycleByPaneKey: { [paneKey]: lifecycle },
        terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) }
      })
    )

    expect(model.counts.idle).toBe(1)
    expect(model.idle[0]?.completionMessage).toBe('Finished.')
    expect(model.idle[0]?.completedAt).toBe(NOW)
    expect(model.idle[0]?.id).toBe(working.working[0]?.id)
  })

  it('uses foreground process evidence as an idle fallback without lifecycle data', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [paneKey]: entry(paneKey, { state: 'done', lastAssistantMessage: 'Finished.' })
        },
        paneForegroundAgentByPaneKey: {
          [paneKey]: { agent: 'codex', shellForeground: false }
        }
      })
    )

    expect(model.idle[0]?.completionMessage).toBe('Finished.')
  })

  it('uses the Agent custom title in the activity list', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: { [paneKey]: entry(paneKey) },
        tabsByWorktree: {
          'wt-1': [{ ...tab('tab-1'), customTitle: 'Review Agent' }]
        }
      })
    )

    expect(model.working[0]?.title).toBe('Review Agent')
  })

  it('reuses the Agent row decayed idle state instead of reclassifying it', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [paneKey]: entry(paneKey, { updatedAt: NOW - 31 * 60_000 })
        },
        paneForegroundAgentByPaneKey: {
          [paneKey]: { agent: 'codex', shellForeground: false }
        }
      })
    )

    expect(model.counts.idle).toBe(1)
    expect(model.counts.working).toBe(0)
  })

  it('shows a newly launched foreground Agent at its prompt as idle', () => {
    const model = buildAgentActivity(
      baseArgs({
        tabsByWorktree: {
          'wt-1': [{ ...tab('tab-1'), title: 'repo terminal' }]
        },
        ptyIdsByTabId: { 'tab-1': ['pty-1'] },
        terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) },
        paneForegroundAgentByPaneKey: {
          [`tab-1:${LEAF_1}`]: { agent: 'codex', shellForeground: false }
        }
      })
    )

    expect(model.counts.idle).toBe(1)
    expect(model.counts.working).toBe(0)
  })

  it('suppresses a retained completion when the same provider session is current', () => {
    const currentPaneKey = `tab-1:${LEAF_1}`
    const completedPaneKey = `tab-2:${LEAF_2}`
    const completedEntry = entry(completedPaneKey, {
      state: 'done',
      lastAssistantMessage: 'Finished.',
      providerSession: { key: 'session_id', id: 'session-1' }
    })
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [currentPaneKey]: entry(currentPaneKey, {
            providerSession: { key: 'session_id', id: 'session-1' }
          })
        },
        tabsByWorktree: { 'wt-1': [tab('tab-1'), tab('tab-2')] },
        retainedAgentsByPaneKey: {
          [completedPaneKey]: {
            entry: completedEntry,
            worktreeId: 'wt-1',
            tab: tab('tab-2'),
            agentType: 'codex',
            startedAt: NOW - 1
          }
        }
      })
    )

    expect(model.counts.working).toBe(1)
    expect(model.idle).toHaveLength(0)
  })

  it('only creates a navigation target when the workspace tab and leaf still exist', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const lifecycle = {
      id: 'lifecycle-1',
      startedAt: NOW - 1,
      paneKey,
      executionHostId: 'local' as const,
      connectionId: null,
      ptyId: 'pty-1',
      runtimeAgent: 'codex' as const,
      providerSessionId: null,
      launchToken: null,
      phase: 'active' as const,
      authorityRevision: 1
    }
    const args = baseArgs({
      agentStatusByPaneKey: { [paneKey]: entry(paneKey, { agentLifecycleId: lifecycle.id }) },
      paneAgentLifecycleByPaneKey: { [paneKey]: lifecycle },
      terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) }
    })

    expect(buildAgentActivity(args).working[0]?.navigationTarget).toMatchObject({
      ptyId: 'pty-1'
    })
    expect(
      buildAgentActivity({ ...args, terminalLayoutsByTabId: {} }).working[0]?.navigationTarget
    ).toBeNull()
  })

  it('keeps retained completion history out of current Agent activity', () => {
    const paneKey = `tab-1:${LEAF_1}`
    const lifecycle = {
      id: 'lifecycle-1',
      startedAt: NOW - 1,
      paneKey,
      executionHostId: 'local' as const,
      connectionId: null,
      ptyId: 'pty-1',
      runtimeAgent: 'codex' as const,
      providerSessionId: null,
      launchToken: null,
      phase: 'active' as const,
      authorityRevision: 1
    }
    const done = entry(paneKey, {
      state: 'done',
      lastAssistantMessage: 'Finished.',
      agentLifecycleId: lifecycle.id
    })
    const retained = buildAgentActivity(
      baseArgs({
        retainedAgentsByPaneKey: {
          [paneKey]: {
            entry: done,
            worktreeId: 'wt-1',
            tab: tab('tab-1'),
            agentType: 'codex',
            startedAt: NOW - 1
          }
        },
        paneAgentLifecycleByPaneKey: { [paneKey]: lifecycle },
        terminalLayoutsByTabId: { 'tab-1': layout(LEAF_1) }
      })
    )

    expect(retained.counts).toEqual({ attention: 0, working: 0, idle: 0 })
  })

  it('sorts waiting attention ahead of blocked attention before timestamp ties', () => {
    const waitingPaneKey = `tab-1:${LEAF_1}`
    const blockedPaneKey = `tab-2:${LEAF_2}`
    const model = buildAgentActivity(
      baseArgs({
        agentStatusByPaneKey: {
          [blockedPaneKey]: entry(blockedPaneKey, { state: 'blocked', stateStartedAt: NOW + 1 }),
          [waitingPaneKey]: entry(waitingPaneKey, { state: 'waiting', stateStartedAt: NOW })
        },
        tabsByWorktree: { 'wt-1': [tab('tab-1'), tab('tab-2')] }
      })
    )

    expect(model.attention.map((item) => item.state)).toEqual(['waiting', 'blocked'])
  })
})
