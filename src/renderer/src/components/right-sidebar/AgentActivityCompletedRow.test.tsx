// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { AgentActivityCompletedRow } from './AgentActivityCompletedRow'
import type { AgentActivityItem } from './agent-activity-types'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>
}))

vi.mock('../sidebar/CommentMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>
}))

vi.mock('./ai-vault-session-log-open', () => ({
  openAiVaultSessionLogInOrca: vi.fn()
}))

function session(): AiVaultSession {
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
    updatedAt: '2026-07-24T00:00:00.000Z',
    modifiedAt: '2026-07-24T00:00:00.000Z',
    messageCount: 2,
    totalTokens: 100,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: "codex resume 'session-1'",
    subagent: null
  }
}

function item(): AgentActivityItem {
  return {
    id: 'completed:session-1',
    kind: 'completed',
    state: 'done',
    paneKey: 'tab-1:leaf-1',
    worktreeId: 'wt-1',
    executionHostId: 'local',
    runtimeAgent: 'codex',
    vaultAgent: 'codex',
    title: 'Workspace',
    subtitle: null,
    message: 'Implemented safely.',
    completionMessage: 'Implemented safely.',
    toolName: null,
    toolInput: null,
    interactivePrompt: null,
    startedAt: 1,
    stateChangedAt: 2,
    updatedAt: 2,
    completedAt: 2,
    providerSessionId: 'session-1',
    agentLifecycleId: 'lifecycle-1',
    agentSessionStartedAt: 1,
    activityIdentity: null,
    matchedSession: session(),
    navigationTarget: null,
    navigationUnavailableReason: null
  }
}

describe('AgentActivityCompletedRow', () => {
  afterEach(() => document.body.replaceChildren())

  it('names every completed-row icon action for assistive technology', () => {
    render(
      <AgentActivityCompletedRow item={item()} canOpenOriginalPane onOpenOriginalPane={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Copy conclusion' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open log' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open original pane' })).toBeTruthy()
  })

  it('expands the completed summary when its row is activated', () => {
    render(
      <AgentActivityCompletedRow
        item={item()}
        canOpenOriginalPane={false}
        onOpenOriginalPane={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('Implemented safely.'))

    expect(screen.getAllByText('Implemented safely.')).toHaveLength(2)
  })
})
