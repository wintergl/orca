// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivityItem } from './agent-activity-types'
import { AgentActivityHiButton } from './AgentActivityHiButton'

const mocks = vi.hoisted(() => ({
  sendHi: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('./agent-activity-hi-send', () => ({
  sendHiToAgentActivity: mocks.sendHi
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error }
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>
}))

function item(kind: AgentActivityItem['kind'] = 'idle'): AgentActivityItem {
  return {
    id: 'current:codex',
    kind,
    state: kind === 'idle' ? 'idle' : kind === 'working' ? 'working' : 'waiting',
    paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
    worktreeId: 'wt-1',
    executionHostId: 'local',
    runtimeAgent: 'codex',
    vaultAgent: 'codex',
    title: 'Codex 1',
    subtitle: null,
    message: null,
    completionMessage: null,
    toolName: null,
    toolInput: null,
    interactivePrompt: null,
    startedAt: 1,
    stateChangedAt: 1,
    updatedAt: 1,
    completedAt: null,
    providerSessionId: null,
    agentLifecycleId: 'lifecycle-1',
    agentSessionStartedAt: 1,
    activityIdentity: null,
    matchedSession: null,
    navigationTarget: {
      worktreeId: 'wt-1',
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      executionHostId: 'local',
      runtimeAgent: 'codex',
      normalizedVaultAgent: 'codex',
      providerSessionId: null,
      agentLifecycleId: 'lifecycle-1',
      ptyId: 'pty-1',
      activityIdentity: { canonicalKey: 'agent-1', aliases: new Set() }
    },
    navigationUnavailableReason: null
  }
}

describe('AgentActivityHiButton', () => {
  afterEach(() => {
    cleanup()
    mocks.sendHi.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('sends one fixed Hi request and prevents duplicate clicks', async () => {
    let resolveSend: ((value: 'sent') => void) | undefined
    mocks.sendHi.mockReturnValue(
      new Promise<'sent'>((resolve) => {
        resolveSend = resolve
      })
    )
    render(<AgentActivityHiButton item={item()} />)

    const button = screen.getByRole('button', { name: 'Send Hi' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(mocks.sendHi).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    resolveSend?.('sent')
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Hi sent'))
  })

  it.each([
    ['working', 'Agent is working'],
    ['attention', 'Agent is waiting for permission']
  ] as const)('disables Hi for an Agent that is %s', (kind, reason) => {
    render(<AgentActivityHiButton item={item(kind)} />)

    const button = screen.getByRole('button', { name: 'Send Hi' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(reason)).toBeTruthy()
    fireEvent.click(button)
    expect(mocks.sendHi).not.toHaveBeenCalled()
  })

  it('shows a clear failure and allows a retry', async () => {
    mocks.sendHi.mockResolvedValueOnce('agent-changed').mockResolvedValueOnce('sent')
    render(<AgentActivityHiButton item={item()} />)

    const button = screen.getByRole('button', { name: 'Send Hi' })
    fireEvent.click(button)
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('The Agent changed before Hi could be sent.')
    )

    fireEvent.click(button)
    await waitFor(() => expect(mocks.sendHi).toHaveBeenCalledTimes(2))
  })
})
