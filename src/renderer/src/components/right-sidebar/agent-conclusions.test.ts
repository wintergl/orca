import { describe, expect, it } from 'vitest'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { buildAgentConclusions, type AgentConclusionWorkspaceInfo } from './agent-conclusions'

function entry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'finish it',
    updatedAt: 200,
    stateStartedAt: 100,
    agentType: 'codex',
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    stateHistory: [],
    lastAssistantMessage: 'Done. The final result is ready.',
    providerSession: { key: 'session_id', id: 'session-1' },
    ...overrides
  }
}

function retained(source: AgentStatusEntry): RetainedAgentEntry {
  return {
    entry: source,
    worktreeId: source.worktreeId ?? 'wt-1',
    tab: { id: source.tabId ?? 'tab-1' } as never,
    agentType: source.agentType ?? 'codex',
    startedAt: 1
  }
}

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'codex:session-1',
    executionHostId: 'local',
    agent: 'codex',
    sessionId: 'session-1',
    title: 'Fix sidebar',
    cwd: '/repo/wt-1',
    branch: null,
    model: 'gpt',
    filePath: '/tmp/session-1.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
    modifiedAt: '2026-07-23T00:00:00.000Z',
    messageCount: 2,
    totalTokens: 100,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: "codex resume 'session-1'",
    subagent: null,
    ...overrides
  }
}

function workspaceInfo(overrides: Partial<AgentConclusionWorkspaceInfo> = {}) {
  return {
    id: 'wt-1',
    title: 'Sidebar work',
    projectKey: 'repo:repo-1',
    executionHostId: 'local' as const,
    ...overrides
  }
}

function build(overrides: Partial<Parameters<typeof buildAgentConclusions>[0]> = {}) {
  const defaultSession = session()
  return buildAgentConclusions({
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    sessions: [defaultSession],
    filteredSessionIds: new Set([defaultSession.id]),
    hasSearchQuery: false,
    enabledVaultAgents: ['codex'],
    vaultScope: 'all',
    executionHostScope: 'all',
    activeProjectKey: null,
    workspaceScopeIds: new Set(['wt-1']),
    workspaceInfoById: new Map([['wt-1', workspaceInfo()]]),
    ...overrides
  })
}

describe('buildAgentConclusions', () => {
  it('keeps wrapper runtime identity while matching Codex AI Vault sessions', () => {
    const source = entry({ agentType: 'codexdb' })
    const conclusions = build({
      retainedAgentsByPaneKey: { [source.paneKey]: retained(source) }
    })

    expect(conclusions).toHaveLength(1)
    expect(conclusions[0]).toMatchObject({
      runtimeAgent: 'codexdb',
      vaultAgent: 'codex',
      matchedSession: expect.objectContaining({ id: 'codex:session-1' })
    })
  })

  it('uses stateStartedAt as the completed time and stable sort key', () => {
    const first = entry({
      paneKey: 'tab-1:leaf-1',
      providerSession: { key: 'session_id', id: 'session-1' },
      stateStartedAt: 100,
      updatedAt: 500
    })
    const second = entry({
      paneKey: 'tab-2:leaf-2',
      providerSession: { key: 'session_id', id: 'session-2' },
      stateStartedAt: 200,
      updatedAt: 300
    })
    const conclusions = build({
      agentStatusByPaneKey: {
        [first.paneKey]: first,
        [second.paneKey]: second
      },
      sessions: [
        session({ id: 'codex:session-1', sessionId: 'session-1' }),
        session({ id: 'codex:session-2', sessionId: 'session-2' })
      ],
      filteredSessionIds: new Set(['codex:session-1', 'codex:session-2'])
    })

    expect(conclusions.map((item) => item.completedAt)).toEqual([200, 100])
  })

  it('keeps only the three most recent conclusions', () => {
    const sources = [1, 2, 3, 4].map((index) =>
      entry({
        paneKey: `tab-${index}:leaf-${index}`,
        tabId: `tab-${index}`,
        providerSession: { key: 'session_id', id: `session-${index}` },
        stateStartedAt: index * 100,
        lastAssistantMessage: `message-${index}`
      })
    )

    const conclusions = build({
      agentStatusByPaneKey: Object.fromEntries(sources.map((source) => [source.paneKey, source])),
      sessions: sources.map((_, index) =>
        session({
          id: `codex:session-${index + 1}`,
          sessionId: `session-${index + 1}`
        })
      ),
      filteredSessionIds: new Set(sources.map((_, index) => `codex:session-${index + 1}`))
    })

    expect(conclusions.map((item) => item.message)).toEqual(['message-4', 'message-3', 'message-2'])
  })

  it('shows unmatched state previews only when search is empty', () => {
    const source = entry({ providerSession: undefined })

    expect(
      build({
        agentStatusByPaneKey: { [source.paneKey]: source },
        sessions: [],
        filteredSessionIds: new Set(),
        hasSearchQuery: false
      })
    ).toHaveLength(1)
    expect(
      build({
        agentStatusByPaneKey: { [source.paneKey]: source },
        sessions: [],
        filteredSessionIds: new Set(),
        hasSearchQuery: true
      })
    ).toHaveLength(0)
  })

  it('hides matched sessions that are outside the filtered session set', () => {
    const source = entry()
    expect(
      build({
        agentStatusByPaneKey: { [source.paneKey]: source },
        filteredSessionIds: new Set()
      })
    ).toHaveLength(0)
  })

  it('excludes interrupted, non-done, empty, and timestamp-less entries', () => {
    const cases = [
      entry({ interrupted: true }),
      entry({ state: 'working' }),
      entry({ lastAssistantMessage: '   ' }),
      entry({ stateStartedAt: Number.NaN })
    ]
    const status = Object.fromEntries(cases.map((item, index) => [`pane-${index}`, item]))

    expect(build({ agentStatusByPaneKey: status })).toHaveLength(0)
  })
})
