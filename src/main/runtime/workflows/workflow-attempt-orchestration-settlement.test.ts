import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import { settleWorkflowAttemptOrchestrationFailed } from './workflow-attempt-orchestration-settlement'

describe('settleWorkflowAttemptOrchestrationFailed', () => {
  it('settles a ready worker dispatch as failed before any retry', () => {
    const settleWorkerReport = vi.fn(() => ({
      action: 'settled' as const,
      outcome: 'failed' as const,
      duplicate: false
    }))
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'ready' })),
      getTask: vi.fn(() => ({ status: 'dispatched' })),
      getDispatchContextById: vi.fn(),
      failWorkerStart: vi.fn(),
      settleWorkerReport
    } as unknown as OrchestrationDb
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      attempt: 1
    } as WorkflowStepRunRecord

    const result = settleWorkflowAttemptOrchestrationFailed(
      orchestration,
      step,
      'invalid decision protocol'
    )

    expect(result).toEqual({ settled: true, duplicate: false })
    expect(settleWorkerReport).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        dispatchId: 'dispatch-1',
        outcome: 'failed'
      })
    )
    expect(orchestration.failWorkerStart).not.toHaveBeenCalled()
  })

  it('is idempotent when task/dispatch already failed', () => {
    const settleWorkerReport = vi.fn()
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'failed' })),
      getTask: vi.fn(() => ({ status: 'failed' })),
      getDispatchContextById: vi.fn(() => ({ status: 'failed' })),
      failWorkerStart: vi.fn(),
      settleWorkerReport
    } as unknown as OrchestrationDb
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      attempt: 1
    } as WorkflowStepRunRecord

    expect(
      settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'already settled')
    ).toEqual({ settled: true, duplicate: true })
    expect(settleWorkerReport).not.toHaveBeenCalled()
  })

  it('fails a starting worker without settleWorkerReport', () => {
    const failWorkerStart = vi.fn()
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'starting' })),
      getTask: vi.fn(),
      settleWorkerReport: vi.fn(),
      failWorkerStart
    } as unknown as OrchestrationDb
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      attempt: 1
    } as WorkflowStepRunRecord

    expect(settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'start failed')).toEqual({
      settled: true,
      duplicate: false
    })
    expect(failWorkerStart).toHaveBeenCalledWith('dispatch-1', 'workflow_engine', 'start failed')
  })
})
