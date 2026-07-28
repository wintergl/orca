// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivityItem } from './agent-activity-types'
import { AgentActivityCurrentRow } from './AgentActivityCurrentRow'

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const writeClipboardText = vi.fn<(text: string) => Promise<void>>()

vi.mock('sonner', () => ({ toast: toastMocks }))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>
}))

function unavailableItem(): AgentActivityItem {
  return {
    id: 'pane:tab-1:leaf-1',
    kind: 'working',
    state: 'working',
    paneKey: 'tab-1:leaf-1',
    worktreeId: 'wt-1',
    executionHostId: 'local',
    runtimeAgent: 'codex',
    vaultAgent: 'codex',
    title: 'Codex',
    subtitle: null,
    message: 'Implementing lifecycle safety',
    completionMessage: null,
    toolName: null,
    toolInput: null,
    interactivePrompt: null,
    startedAt: 1,
    stateChangedAt: 1,
    updatedAt: 1,
    completedAt: null,
    providerSessionId: null,
    agentLifecycleId: null,
    agentSessionStartedAt: null,
    activityIdentity: null,
    matchedSession: null,
    navigationTarget: null,
    navigationUnavailableReason: 'pane-unavailable'
  }
}

describe('AgentActivityCurrentRow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText } }
    })
    writeClipboardText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    writeClipboardText.mockReset()
    toastMocks.success.mockReset()
    toastMocks.error.mockReset()
  })

  it('renders an unavailable current pane as a static row instead of a button', () => {
    render(<AgentActivityCurrentRow item={unavailableItem()} />)

    expect(screen.getByLabelText('Agent pane unavailable')).toBeTruthy()
    expect(screen.getByLabelText('Working')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Agent pane is unavailable')).toBeTruthy()
  })

  it('shows compact elapsed state time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(180_000)
    try {
      render(<AgentActivityCurrentRow item={{ ...unavailableItem(), stateChangedAt: 60_000 }} />)

      expect(screen.getByText('State changed 2m ago')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an open agent idle while exposing its final conclusion for copying', async () => {
    render(
      <AgentActivityCurrentRow
        item={{
          ...unavailableItem(),
          kind: 'idle',
          state: 'idle',
          message: 'Finished safely.',
          completionMessage: 'Finished safely.'
        }}
      />
    )

    expect(screen.getByText('Open · idle')).toBeTruthy()
    expect(screen.getByLabelText('Idle')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy conclusion' }))

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('Finished safely.'))
    expect(toastMocks.success).toHaveBeenCalledWith('Conclusion copied')
  })
})
