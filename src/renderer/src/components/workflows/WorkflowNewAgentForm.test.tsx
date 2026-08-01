// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNewAgentForm } from './WorkflowNewAgentForm'

afterEach(cleanup)

describe('WorkflowNewAgentForm', () => {
  it('submits a one-session command override and YOLO mode', () => {
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

    fireEvent.change(screen.getByLabelText('Launch command'), {
      target: { value: 'codex --profile review' }
    })
    fireEvent.click(screen.getByLabelText('YOLO permissions'))
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Codex',
      agent: 'codex',
      agentCommand: 'codex --profile review',
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
})
