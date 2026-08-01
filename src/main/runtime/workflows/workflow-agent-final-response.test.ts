import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import { inspectWorkerTerminal } from '../rpc/methods/orchestration-worker-observation'
import { readExactWorkerOutput } from '../rpc/methods/orchestration-worker-output'
import {
  assertWorkflowAgentLifecycle,
  claimWorkflowAgentLifecycle
} from './workflow-agent-lifecycle-authority'
import { readWorkflowAgentFinalResponse } from './workflow-agent-final-response'

vi.mock('../rpc/methods/orchestration-worker-observation', () => ({
  inspectWorkerTerminal: vi.fn()
}))
vi.mock('../rpc/methods/orchestration-worker-output', () => ({
  readExactWorkerOutput: vi.fn()
}))

const assignment = {
  worktreeId: 'workspace-a',
  executionHostId: 'local',
  paneKey: 'pane-author',
  agentLifecycleId: 'lifecycle-author',
  providerSessionId: null,
  runtimeAgent: 'claude'
}
const step = {
  id: 'step-author',
  dispatchId: 'dispatch-author',
  prompt: 'Write the next SPEC.',
  assignment
} as WorkflowStepRunRecord

beforeEach(() => {
  vi.mocked(inspectWorkerTerminal).mockResolvedValue({ exact: true, status: 'running' } as never)
  vi.mocked(readExactWorkerOutput).mockResolvedValue({
    source: 'transcript',
    sourceIdentity: 'claude:session-author',
    warnings: [],
    cursor: undefined,
    transcript: {
      messages: [
        { role: 'user', blocks: [{ type: 'text', text: step.prompt }] },
        { role: 'assistant', blocks: [{ type: 'text', text: 'SPEC complete.' }] }
      ],
      limited: false
    }
  } as never)
})

describe('Workflow Agent final response', () => {
  it('binds a Provider Session that appears after an idle Agent was assigned', async () => {
    let sessionId: string | null = null
    const runtime = {
      getOrchestrationDb: () => ({
        getWorkerDispatch: () => ({
          agent_terminal_handle: 'terminal-author',
          created_at: '2026-08-01 00:00:00'
        })
      }),
      getTerminalProcessIncarnation: () => 'process-author',
      getAgentLifecycleAuthorityIdForPaneKey: () => 'lifecycle-author',
      getExactWorkerProviderSession: () =>
        sessionId
          ? {
              providerSession: { key: 'session_id', id: sessionId }
            }
          : null
    } as unknown as OrcaRuntimeService
    claimWorkflowAgentLifecycle(runtime, assignment, 'terminal-author')
    sessionId = 'session-author'

    await expect(readWorkflowAgentFinalResponse(runtime, step)).resolves.toEqual({
      text: 'SPEC complete.',
      sourceIdentity: 'claude:session-author'
    })
    expect(assertWorkflowAgentLifecycle(runtime, assignment, 'terminal-author')).toBe(
      'session-author'
    )
  })
})
