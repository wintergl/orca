import { describe, expect, it } from 'vitest'
import { applyAgentRowLineage } from '@/components/dashboard/agent-row-lineage'
import type { TerminalLayoutSnapshot, TerminalTab, TuiAgent } from '../../../../shared/types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import { buildWorktreeAgentRows } from './worktree-agent-rows'

const LEAF_ID_1 = '77777777-7777-4777-8777-777777777777'
const LEAF_ID_2 = '88888888-8888-4888-8888-888888888888'

function makeTab(id: string, overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id,
    worktreeId: 'wt-1',
    ptyId: null,
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function makeSplitLayout(): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_ID_1 },
      second: { type: 'leaf', leafId: LEAF_ID_2 }
    },
    activeLeafId: LEAF_ID_1,
    expandedLeafId: null
  }
}

function makeSingleLayout(leafId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null
  }
}

describe('buildTitleDerivedAgentRows', () => {
  it('adds title-derived rows for live agent panes that have no hook status yet', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': {
          1: 'Antigravity',
          2: '⠋ Codex'
        }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-left', 'pty-right'] },
      terminalLayoutsByTabId: { 'tab-1': makeSplitLayout() },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.lastAssistantMessage])).toEqual([
      ['antigravity', 'idle', 'Idle'],
      ['codex', 'working', 'Running']
    ])
    expect(rows.map((row) => row.paneKey)).toEqual([
      makePaneKey('tab-1', LEAF_ID_1),
      makePaneKey('tab-1', LEAF_ID_2)
    ])
  })

  it('lets live title evidence replace a stale hook row for the same Pane', () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID_1)
    const now = AGENT_STATUS_STALE_AFTER_MS + 2_000
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [
        {
          paneKey,
          state: 'waiting',
          prompt: 'Old permission request',
          updatedAt: 1,
          stateStartedAt: 1,
          stateHistory: [],
          agentType: 'codex',
          lastAssistantMessage: 'Older provider summary',
          providerSession: { key: 'session_id', id: 'session-1' },
          agentLifecycleId: 'lifecycle-1',
          agentSessionStartedAt: 1
        }
      ],
      retained: [],
      runtimePaneTitlesByTabId: { 'tab-1': { 1: '⠋ Codex' } },
      ptyIdsByTabId: { 'tab-1': ['ssh:host-a@@pty-1'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      paneAgentLifecycleByPaneKey: {
        [paneKey]: {
          id: 'lifecycle-1',
          startedAt: 1,
          paneKey,
          executionHostId: 'ssh:host-a',
          connectionId: 'host-a',
          ptyId: 'ssh:host-a@@pty-1',
          runtimeAgent: 'codex',
          providerSessionId: 'session-1',
          launchToken: null,
          phase: 'active',
          authorityRevision: 1
        }
      },
      now
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rowSource: 'title',
      presenceEvidence: 'live-title',
      contentEvidence: 'provider',
      state: 'working',
      entry: {
        lastAssistantMessage: 'Older provider summary',
        agentLifecycleId: 'lifecycle-1',
        executionHostId: 'ssh:host-a'
      }
    })
  })

  it('normalizes Pi-compatible title-derived rows to the launched OMP owner', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent: 'omp' })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': {
          1: '\u280b π: tmp'
        }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-omp'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.terminalTitle])).toEqual([
      ['omp', 'working', '\u280b OMP']
    ])
  })

  it('keeps Pi-compatible title-derived rows as Pi for launched Pi sessions', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent: 'pi' })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': {
          1: '\u280b Pi'
        }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-pi'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.terminalTitle])).toEqual([
      ['pi', 'working', '\u280b Pi']
    ])
  })

  it('does not add title-derived rows for panes without a live PTY', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: '⠋ Codex' }
      },
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: { 'tab-1': makeSplitLayout() },
      now: 2000
    })

    expect(rows).toHaveLength(0)
  })

  it('uses runtime orchestration metadata for title-derived worker rows', () => {
    const parentPaneKey = makePaneKey('tab-parent', LEAF_ID_1)
    const childPaneKey = makePaneKey('tab-child', LEAF_ID_2)
    const rows = applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: [makeTab('tab-parent'), makeTab('tab-child')],
        entries: [],
        retained: [],
        runtimePaneTitlesByTabId: {
          'tab-parent': { 1: '⠋ Codex' },
          'tab-child': { 1: '⠋ Claude Code' }
        },
        ptyIdsByTabId: {
          'tab-parent': ['pty-parent'],
          'tab-child': ['pty-child']
        },
        terminalLayoutsByTabId: {
          'tab-parent': makeSingleLayout(LEAF_ID_1),
          'tab-child': makeSingleLayout(LEAF_ID_2)
        },
        runtimeAgentOrchestrationByPaneKey: {
          [childPaneKey]: {
            taskId: 'task-1',
            dispatchId: 'ctx-1',
            parentPaneKey
          }
        },
        now: 2000
      })
    )

    expect(rows.map((row) => row.paneKey)).toEqual([parentPaneKey, childPaneKey])
    expect(rows[0].lineage).toMatchObject({ depth: 0, childCount: 1 })
    expect(rows[1].lineage).toMatchObject({ depth: 1, childCount: 0 })
    expect(rows[1].entry.orchestration).toMatchObject({ parentPaneKey })
  })

  it('does not infer Claude Code from a spinner-only non-agent title', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: '⠋ installing dependencies' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-plain'] },
      terminalLayoutsByTabId: { 'tab-1': makeSplitLayout() },
      now: 2000
    })

    expect(rows).toHaveLength(0)
  })

  it('adds an idle Claude row for the Claude agents surface', () => {
    for (const title of [
      'claude agents',
      String.raw`C:\Users\dev\AppData\Roaming\npm\claude.cmd agents`
    ]) {
      const rows = buildWorktreeAgentRows({
        tabs: [makeTab('tab-1')],
        entries: [],
        retained: [],
        runtimePaneTitlesByTabId: {
          'tab-1': { 1: title }
        },
        ptyIdsByTabId: { 'tab-1': ['pty-claude-agents'] },
        terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
        now: 2000
      })

      expect(rows.map((row) => [row.agentType, row.state, row.entry.lastAssistantMessage])).toEqual(
        [['claude', 'idle', 'Idle']]
      )
    }
  })

  it('attributes a spinner-only title to the launched agent when the title has no identity', () => {
    const launchAgent: TuiAgent = 'codex'
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        // Codex over SSH emits spinner + cwd titles with no agent name (#8711).
        'tab-1': { 1: '⠼ demo-repo' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codex-remote'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(
      rows.map((row) => [row.agentType, row.state, row.entry.prompt, row.entry.terminalTitle])
    ).toEqual([['codex', 'working', 'Codex', '⠼ demo-repo']])
  })

  it('keeps explicit title identity over the launched agent', () => {
    const launchAgent: TuiAgent = 'claude'
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: '⠋ Codex' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-explicit'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state])).toEqual([['codex', 'working']])
  })

  it('normalizes Codex title fallback rows to the launched wrapper owner', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent: 'codexdba' })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: 'Codex ready' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codexdba'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.prompt])).toEqual([
      ['codexdba', 'idle', 'Codex (Doubao Agent)']
    ])
  })

  it('recognizes explicit Codex wrapper titles without hook status', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: 'codexdb ready' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codexdb'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.prompt])).toEqual([
      ['codexdb', 'idle', 'Codex (Doubao Coding)']
    ])
  })

  it('keeps a launched Codex wrapper visible from foreground process identity', () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID_1)
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent: 'codexdb' })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: 'demo-repo' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codexdb'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      paneForegroundAgentByPaneKey: {
        [paneKey]: { agent: 'codex', shellForeground: false }
      },
      now: 2000
    })

    expect(rows.map((row) => [row.agentType, row.state, row.entry.prompt])).toEqual([
      ['codexdb', 'idle', 'Codex (Doubao Coding)']
    ])
  })

  it('does not keep a foreground-derived wrapper row after shell foreground is confirmed', () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID_1)
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent: 'codexdba' })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: 'demo-repo' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codexdba'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      paneForegroundAgentByPaneKey: {
        [paneKey]: { agent: 'codex', shellForeground: true }
      },
      now: 2000
    })

    expect(rows).toHaveLength(0)
  })

  it('produces no row for a spinner-only title when the tab has no launch identity', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        // Spinner activity but no identity and no launchAgent to attribute it to.
        'tab-1': { 1: '⠼ demo-repo' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-anon'] },
      terminalLayoutsByTabId: { 'tab-1': makeSingleLayout(LEAF_ID_1) },
      now: 2000
    })

    expect(rows).toHaveLength(0)
  })

  it('does not turn generic Codex-launched task titles into Claude Code rows', () => {
    const launchAgent: TuiAgent = 'codex'
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1', { launchAgent })],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: {
        'tab-1': { 1: '✳ refactor split-pane status' }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-codex'] },
      terminalLayoutsByTabId: { 'tab-1': makeSplitLayout() },
      now: 2000
    })

    expect(rows).toHaveLength(0)
  })
})
