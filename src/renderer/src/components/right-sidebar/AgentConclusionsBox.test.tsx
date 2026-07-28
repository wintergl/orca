// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { AgentConclusionsBox } from './AgentConclusionsBox'
import type { AgentConclusionItem } from './agent-conclusions'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: toastMocks
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>
}))

vi.mock('../sidebar/CommentMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>
}))

const writeClipboardText = vi.fn<(text: string) => Promise<void>>()

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

function item(overrides: Partial<AgentConclusionItem> = {}): AgentConclusionItem {
  return {
    id: 'item-1',
    paneKey: 'tab-1:leaf-1',
    worktreeId: 'wt-1',
    runtimeAgent: 'codex',
    vaultAgent: 'codex',
    title: 'Sidebar work',
    subtitle: null,
    message: 'Done. The final result is ready.',
    completedAt: Date.UTC(2026, 6, 23, 8, 30),
    providerSessionId: 'session-1',
    matchedSession: session(),
    ...overrides
  }
}

describe('AgentConclusionsBox', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ui: { writeClipboardText }
      }
    })
    writeClipboardText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.replaceChildren()
    writeClipboardText.mockReset()
    toastMocks.success.mockReset()
    toastMocks.error.mockReset()
  })

  it('copies the conclusion body directly', async () => {
    render(<AgentConclusionsBox items={[item({ message: 'Final **answer**' })]} />)

    fireEvent.click(screen.getByLabelText('Copy conclusion'))

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('Final **answer**'))
    expect(toastMocks.success).toHaveBeenCalledWith('Conclusion copied')
  })

  it('does not render log or pane actions in the expanded conclusion', () => {
    render(<AgentConclusionsBox items={[item()]} />)

    fireEvent.click(screen.getByText('Done. The final result is ready.'))

    expect(screen.queryByText('Open log')).toBeNull()
    expect(screen.queryByText('Open pane')).toBeNull()
  })
})
