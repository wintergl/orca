// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCreationDialog } from './AgentCreationDialog'

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

afterEach(cleanup)

describe('AgentCreationDialog', () => {
  it('requires a command and saves a reusable profile without a workspace', async () => {
    const onCreateProfile = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(
      <AgentCreationDialog
        open
        agents={[
          {
            id: 'codex',
            label: 'Codex',
            commandHint: 'codex',
            supportsYolo: true,
            defaultYolo: false
          }
        ]}
        detecting={false}
        onOpenChange={onOpenChange}
        onCreateProfile={onCreateProfile}
      />
    )

    const createButton = screen.getByRole('button', { name: 'Create Agent' })
    expect(createButton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Codex DBA' } })
    fireEvent.change(screen.getByLabelText('Launch command'), {
      target: { value: 'codex --profile dba' }
    })
    fireEvent.click(createButton)

    await waitFor(() =>
      expect(onCreateProfile).toHaveBeenCalledWith({
        title: 'Codex DBA',
        agent: 'codex',
        agentCommand: 'codex --profile dba',
        permissionMode: 'manual'
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
