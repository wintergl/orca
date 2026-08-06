import { describe, expect, it, vi } from 'vitest'
import type { AgentActivityItem } from '../right-sidebar/agent-activity-types'
import {
  cancelWorkflowAgentMouseDrag,
  readWorkflowAgentDrag,
  readWorkflowAgentMouseDropButton,
  readWorkflowAgentMouseDrop,
  startWorkflowAgentMouseDrag,
  toWorkflowAssignableAgent,
  WORKFLOW_AGENT_DRAG_MIME,
  writeWorkflowAgentDrag
} from './workflow-agent-drag'

function idleItem(): AgentActivityItem {
  return {
    id: 'agent-1',
    kind: 'idle',
    state: 'idle',
    paneKey: 'pane-1',
    worktreeId: 'worktree-1',
    executionHostId: 'local',
    runtimeAgent: 'codex',
    vaultAgent: null,
    title: 'Codex',
    subtitle: null,
    message: 'Idle task summary',
    completionMessage: 'Sensitive conclusion',
    toolName: null,
    toolInput: null,
    interactivePrompt: 'Sensitive prompt',
    startedAt: null,
    stateChangedAt: 1,
    updatedAt: 1,
    completedAt: null,
    providerSessionId: null,
    agentLifecycleId: 'lifecycle-1',
    agentSessionStartedAt: 1,
    activityIdentity: null,
    matchedSession: null,
    navigationTarget: {
      worktreeId: 'worktree-1',
      paneKey: 'pane-1',
      executionHostId: 'local',
      runtimeAgent: 'codex',
      normalizedVaultAgent: null,
      providerSessionId: null,
      agentLifecycleId: 'lifecycle-1',
      ptyId: 'pty-1',
      activityIdentity: { canonicalKey: 'key', aliases: new Set(['key']) }
    },
    navigationUnavailableReason: null
  }
}

describe('Workflow Agent drag payload', () => {
  it('contains only assignment identity and excludes prompts, credentials, and conclusions', () => {
    const values = new Map<string, string>()
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        effectAllowed: 'none',
        setData: (type: string, value: string) => values.set(type, value)
      }
    } as unknown as React.DragEvent
    writeWorkflowAgentDrag(event, idleItem())
    const raw = values.get(WORKFLOW_AGENT_DRAG_MIME) ?? ''
    expect(raw).toContain('lifecycle-1')
    expect(raw).not.toContain('Sensitive prompt')
    expect(raw).not.toContain('Sensitive conclusion')
    expect(raw).not.toContain('Idle task summary')
    expect(readWorkflowAgentDrag({ getData: () => raw })).toMatchObject({
      paneKey: 'pane-1',
      agentLifecycleId: 'lifecycle-1'
    })
    expect(toWorkflowAssignableAgent(idleItem())?.label).toBe('Codex')
  })

  it('accepts only idle Agents and rejects identity-ambiguous sources', () => {
    expect(
      toWorkflowAssignableAgent({
        ...idleItem(),
        kind: 'working',
        state: 'working'
      })
    ).toBeNull()
    expect(toWorkflowAssignableAgent({ ...idleItem(), navigationTarget: null })).toBeNull()
  })

  it('consumes a transient mouse-drop button payload exactly once', () => {
    const button = {
      dataset: {
        workflowAgentDropPayload: JSON.stringify({
          id: 'agent-1',
          worktreeId: 'worktree-1',
          executionHostId: 'local',
          paneKey: 'pane-1',
          agentLifecycleId: 'lifecycle-1'
        })
      }
    } as unknown as HTMLButtonElement

    expect(readWorkflowAgentMouseDropButton(button)).toMatchObject({
      agentLifecycleId: 'lifecycle-1',
      paneKey: 'pane-1'
    })
    expect(readWorkflowAgentMouseDropButton(button)).toBeNull()
  })

  it('accepts a mouse drag only after the movement threshold', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    const mouseDown = {
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault: vi.fn()
    } as unknown as React.MouseEvent
    startWorkflowAgentMouseDrag(mouseDown, idleItem())
    expect(mouseDown.preventDefault).toHaveBeenCalledOnce()

    expect(
      readWorkflowAgentMouseDrop({
        clientX: 30,
        clientY: 10
      } as React.MouseEvent)
    ).toMatchObject({ agentLifecycleId: 'lifecycle-1', paneKey: 'pane-1' })

    startWorkflowAgentMouseDrag(mouseDown, idleItem())
    expect(
      readWorkflowAgentMouseDrop({
        clientX: 15,
        clientY: 10
      } as React.MouseEvent)
    ).toBeNull()
    cancelWorkflowAgentMouseDrag()
    vi.unstubAllGlobals()
  })
})
