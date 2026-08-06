// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNewAgentForm } from './WorkflowNewAgentForm'

afterEach(cleanup)

describe('WorkflowNewAgentForm', () => {
  it('creates a provider alias with a custom name, command, and YOLO mode', () => {
    const onCreate = vi.fn()
    render(
      <WorkflowNewAgentForm
        agents={[
          {
            id: 'codex',
            label: 'Codex',
            commandHint: 'codex',
            supportsYolo: true,
            defaultYolo: false
          }
        ]}
        creating={false}
        onBack={vi.fn()}
        onCreate={onCreate}
      />
    )

    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'Codex DBA' }
    })
    fireEvent.change(screen.getByLabelText('Launch command'), {
      target: { value: 'codexdba' }
    })
    fireEvent.click(screen.getByLabelText('YOLO permissions'))
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Codex DBA',
      agent: 'codex',
      agentCommand: 'codexdba',
      permissionMode: 'yolo'
    })
  })

  it('omits permission configuration for unsupported Agents', () => {
    const onCreate = vi.fn()
    render(
      <WorkflowNewAgentForm
        agents={[
          {
            id: 'opencode',
            label: 'OpenCode',
            commandHint: 'opencode',
            supportsYolo: false,
            defaultYolo: false
          }
        ]}
        creating={false}
        onBack={vi.fn()}
        onCreate={onCreate}
      />
    )

    expect(screen.queryByLabelText('YOLO permissions')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    expect(onCreate).toHaveBeenCalledWith({ title: 'OpenCode', agent: 'opencode' })
  })

  it('requires a non-empty Agent name', () => {
    const onCreate = vi.fn()
    render(
      <WorkflowNewAgentForm
        agents={[
          {
            id: 'codex',
            label: 'Codex',
            commandHint: 'codex',
            supportsYolo: true,
            defaultYolo: false
          }
        ]}
        creating={false}
        onBack={vi.fn()}
        onCreate={onCreate}
      />
    )

    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Create Agent' })).toHaveProperty('disabled', true)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('prefills the command and permission mode from a saved custom profile', () => {
    const onCreate = vi.fn()
    render(
      <WorkflowNewAgentForm
        agents={[
          {
            selectionId: 'custom:profile-1',
            id: 'codex',
            label: 'Codex DBA',
            commandHint: 'codex --profile dba',
            defaultCommand: 'codex --profile dba',
            supportsYolo: true,
            defaultYolo: true
          }
        ]}
        creating={false}
        onBack={vi.fn()}
        onCreate={onCreate}
      />
    )

    expect(screen.getByLabelText('Launch command')).toHaveProperty('value', 'codex --profile dba')
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    expect(onCreate).toHaveBeenCalledWith({
      title: 'Codex DBA',
      agent: 'codex',
      agentCommand: 'codex --profile dba',
      permissionMode: 'yolo'
    })
  })
})
