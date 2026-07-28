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

  it('keeps a done hook row current when the foreground process still proves the agent is open', () => {
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

    expect(model.counts.idle).toBe(1)
    expect(model.counts.completed).toBe(0)
    expect(model.idle[0]?.completionMessage).toBe('Finished.')
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
    expect(model.counts.completed).toBe(0)
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

    expect(buildAgentActivity(args).working[0]?.navigationTarget).not.toBeNull()
    expect(
      buildAgentActivity({ ...args, terminalLayoutsByTabId: {} }).working[0]?.navigationTarget
    ).toBeNull()
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
