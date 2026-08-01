import { describe, expect, it, vi } from 'vitest'
import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  assertWorkflowAgentLifecycle,
  claimWorkflowAgentLifecycle
} from './workflow-agent-lifecycle-authority'

type Assignment = Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>

function assignment(paneKey: string): Assignment {
  return {
    worktreeId: 'workspace-a',
    executionHostId: 'local',
    paneKey,
    agentLifecycleId: `lifecycle-${paneKey}`,
    providerSessionId: null,
    runtimeAgent: 'claude'
  }
}

describe('Workflow Agent lifecycle authority', () => {
  it('hydrates three independent Provider Sessions without merging their Agent identities', () => {
    const sessions = new Map<string, string>()
    const runtime = {
      getTerminalProcessIncarnation: vi.fn((handle: string) => `process-${handle}`),
      getExactWorkerProviderSession: vi.fn((handle: string) => {
        const sessionId = sessions.get(handle)
        return sessionId
          ? {
              providerSession: { key: 'session_id', id: sessionId }
            }
          : null
      }),
      getAgentLifecycleAuthorityIdForPaneKey: vi.fn((paneKey: string) => `lifecycle-${paneKey}`)
    } as unknown as OrcaRuntimeService
    const bindings = ['author', 'reviewer', 'decider'].map((name) => ({
      assignment: assignment(`pane-${name}`),
      handle: `terminal-${name}`
    }))
    for (const binding of bindings) {
      claimWorkflowAgentLifecycle(runtime, binding.assignment, binding.handle)
      sessions.set(binding.handle, `session-${binding.handle}`)
    }

    expect(
      bindings.map((binding) =>
        assertWorkflowAgentLifecycle(runtime, binding.assignment, binding.handle)
      )
    ).toEqual(['session-terminal-author', 'session-terminal-reviewer', 'session-terminal-decider'])

    sessions.set('terminal-author', 'replacement-session')
    expect(() =>
      assertWorkflowAgentLifecycle(runtime, bindings[0]!.assignment, bindings[0]!.handle)
    ).toThrow('assigned idle lifecycle')
    expect(
      assertWorkflowAgentLifecycle(runtime, bindings[1]!.assignment, bindings[1]!.handle)
    ).toBe('session-terminal-reviewer')
  })
})
