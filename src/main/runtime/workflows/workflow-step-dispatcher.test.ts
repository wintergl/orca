import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowAgentAssignment,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { claimWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { WorkflowStepDispatcher } from './workflow-step-dispatcher'
import { WorkflowStore } from './workflow-store'

const stores: WorkflowStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
})

function harness(
  dispatchStatus: 'starting' | 'dispatched',
  workerState: 'starting' | 'ready',
  sessionIds: { assigned: string | null; observed: string | null } = {
    assigned: 'session-author',
    observed: 'session-author'
  }
) {
  let observedSessionId = sessionIds.observed
  const assignment = {
    nodeId: 'code-produce',
    slotId: 'author',
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey: 'pane-author',
    agentLifecycleId: 'lifecycle-author',
    providerSessionId: sessionIds.assigned,
    runtimeAgent: 'codex'
  } satisfies WorkflowAgentAssignment
  const getTerminalAgentStatus = vi.fn().mockResolvedValue({
    handle: 'terminal-author',
    isRunningAgent: true,
    status: 'working'
  })
  const runtime = {
    resolveTerminalPane: vi.fn(() => ({ handle: 'terminal-author', worktreeId: 'folder-a' })),
    getTerminalAgentStatus,
    getTerminalProcessIncarnation: vi.fn(() => 'process-author'),
    getExactWorkerProviderSession: vi.fn(() =>
      observedSessionId ? { providerSession: { key: 'session_id', id: observedSessionId } } : null
    ),
    getAgentLifecycleAuthorityIdForPaneKey: vi.fn(() => 'lifecycle-author')
  } as unknown as OrcaRuntimeService
  const orchestration = {
    getDispatchContextById: vi.fn(() => ({ id: 'dispatch-1', status: dispatchStatus })),
    getWorkerDispatch: vi.fn(() => ({ state: workerState })),
    getTask: vi.fn(() => ({ id: 'task-1' }))
  } as unknown as OrchestrationDb
  const run = {
    id: 'run-1',
    orchestrationRunId: 'orchestration-run-1',
    workspace: { kind: 'folder-workspace', id: 'folder-a' },
    executionHostId: 'local'
  } as unknown as WorkflowRunRecord
  const step = {
    id: 'step-1',
    nodeId: 'code-produce',
    round: 1,
    attempt: 1,
    taskId: 'task-1',
    dispatchId: 'dispatch-1',
    assignment,
    status: 'delivering',
    deliveryState: 'delivered'
  } as unknown as WorkflowStepRunRecord
  claimWorkflowAgentLifecycle(runtime, assignment, 'terminal-author')
  const store = new WorkflowStore(':memory:')
  stores.push(store)
  return {
    dispatcher: new WorkflowStepDispatcher(runtime, store, orchestration),
    getTerminalAgentStatus,
    run,
    step,
    setObservedSessionId: (value: string) => {
      observedSessionId = value
    }
  }
}

describe('WorkflowStepDispatcher', () => {
  it('accepts a working Agent when its existing Dispatch is already ready', async () => {
    const subject = harness('dispatched', 'ready')

    await expect(subject.dispatcher.dispatch(subject.run, subject.step, 'user-a')).resolves.toBe(
      undefined
    )
    expect(subject.getTerminalAgentStatus).not.toHaveBeenCalled()
  })

  it('accepts a Provider Session that appears after the idle Agent assignment', async () => {
    const subject = harness('dispatched', 'ready', { assigned: null, observed: null })
    subject.setObservedSessionId('session-author')

    await expect(subject.dispatcher.dispatch(subject.run, subject.step, 'user-a')).resolves.toBe(
      undefined
    )
    expect(subject.getTerminalAgentStatus).not.toHaveBeenCalled()
  })

  it('still requires an idle Agent before a new prompt can be delivered', async () => {
    const subject = harness('starting', 'starting')

    await expect(subject.dispatcher.dispatch(subject.run, subject.step, 'user-a')).rejects.toThrow(
      'terminal_guard_not_idle'
    )
    expect(subject.getTerminalAgentStatus).toHaveBeenCalledOnce()
  })
})
