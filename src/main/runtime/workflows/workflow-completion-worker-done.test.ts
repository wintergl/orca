import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  settleOrchestrationViaInternalWorkerDone,
  workflowWorkerDoneMessageId
} from './workflow-completion-worker-done'

function runtimeStub(): OrcaRuntimeService {
  return {
    resolveTerminalPane: vi.fn(() => ({ handle: 'agent-handle' })),
    notifyMessageArrived: vi.fn()
  } as unknown as OrcaRuntimeService
}

function prepared() {
  return {
    value: {
      schema: 'workflow.completion/v1' as const,
      outcome: 'succeeded' as const,
      readyForNextStep: true
    },
    source: 'report-path' as const,
    digest: 'digest-1',
    sourceIdentity: 'agent',
    sourceReference: { reportPath: '/tmp/r.json', preparedAt: new Date().toISOString() },
    warnings: [] as string[],
    filesModified: ['a.ts'],
    reportPath: '/tmp/r.json'
  }
}

function step(): WorkflowStepRunRecord {
  return {
    id: 'step-1',
    taskId: 'task-1',
    dispatchId: 'dispatch-1',
    attempt: 1,
    assignment: {
      paneKey: 'pane-1',
      worktreeId: 'ws-1',
      slotId: 'primary',
      agentLifecycleId: 'life-1',
      executionHostId: 'local',
      providerSessionId: null,
      runtimeAgent: null,
      nodeId: 'code-produce'
    }
  } as WorkflowStepRunRecord
}

describe('workflowWorkerDoneMessageId', () => {
  it('is deterministic for a receipt', () => {
    expect(workflowWorkerDoneMessageId('workflow_completion_abc')).toBe(
      'workflow_wd_workflow_completion_abc'
    )
  })
})

describe('settleOrchestrationViaInternalWorkerDone', () => {
  it('returns existing worker_done identity on completed Orchestration terminals', () => {
    const receiptId = 'workflow_completion_abc'
    const messageId = workflowWorkerDoneMessageId(receiptId)
    const message = {
      id: messageId,
      payload: JSON.stringify({ receiptId, taskId: 'task-1', dispatchId: 'dispatch-1' })
    }
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
      getTask: vi.fn(() => ({ status: 'completed' })),
      getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
      getRunMailboxHistory: vi.fn(() => []),
      getMessageById: vi.fn((id: string) => (id === messageId ? message : undefined)),
      insertMessage: vi.fn()
    } as unknown as OrchestrationDb
    const settlement = settleOrchestrationViaInternalWorkerDone({
      runtime: runtimeStub(),
      orchestration,
      run: {
        id: 'run-1',
        orchestrationRunId: 'orch-1',
        status: 'running'
      } as WorkflowRunRecord,
      step: step(),
      prepared: prepared() as never,
      receiptId,
      messageDigest: 'digest-1'
    })
    expect(settlement).toEqual({
      settled: true,
      failureTerminal: false,
      messageId,
      duplicate: true
    })
    expect(orchestration.insertMessage).not.toHaveBeenCalled()
  })

  it('uses a deterministic worker_done id and reuses it on unique conflict', () => {
    const receiptId = 'workflow_completion_def'
    const messageId = workflowWorkerDoneMessageId(receiptId)
    const store = new Map<string, { id: string; payload: string }>()
    const insertMessage = vi.fn((msg: { id?: string; payload?: string }) => {
      if (msg.id && store.has(msg.id)) {
        throw Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' })
      }
      const row = { id: msg.id!, payload: msg.payload ?? '' }
      store.set(row.id, row)
      return row
    })
    const getMessageById = vi.fn((id: string) => store.get(id))
    insertMessage({
      id: messageId,
      payload: JSON.stringify({ receiptId, digest: 'd1' })
    })
    let recovered: { id: string } | null = null
    try {
      insertMessage({ id: messageId, payload: JSON.stringify({ receiptId, digest: 'd1' }) })
    } catch {
      recovered = getMessageById(messageId) as { id: string }
    }
    expect(recovered?.id).toBe(messageId)
    expect(store.size).toBe(1)
  })
})
