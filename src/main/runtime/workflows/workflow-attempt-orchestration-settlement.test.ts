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
      getDispatchContextById: vi.fn(() => ({ status: 'dispatched' })),
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
      settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'invalid decision protocol')
    ).toEqual({ settled: true, duplicate: false, successTerminal: false })
    expect(settleWorkerReport).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        dispatchId: 'dispatch-1',
        outcome: 'failed'
      })
    )
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
    ).toEqual({ settled: true, duplicate: true, successTerminal: false })
    expect(settleWorkerReport).not.toHaveBeenCalled()
  })

  it('marks successful orchestration terminals without re-failing them', () => {
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
      getTask: vi.fn(() => ({ status: 'completed' })),
      getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
      failWorkerStart: vi.fn(),
      settleWorkerReport: vi.fn()
    } as unknown as OrchestrationDb
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      attempt: 1
    } as WorkflowStepRunRecord

    expect(
      settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'timeout after success')
    ).toEqual({ settled: true, duplicate: true, successTerminal: true })
    expect(orchestration.settleWorkerReport).not.toHaveBeenCalled()
  })

  it('detects success on re-query when fail settlement loses the race', () => {
    let afterSettle = false
    const settleWorkerReport = vi.fn(() => {
      afterSettle = true
      return null
    })
    const orchestration = {
      getWorkerDispatch: vi.fn(() => (afterSettle ? { state: 'succeeded' } : { state: 'ready' })),
      getTask: vi.fn(() => (afterSettle ? { status: 'completed' } : { status: 'dispatched' })),
      getDispatchContextById: vi.fn(() =>
        afterSettle ? { status: 'completed' } : { status: 'dispatched' }
      ),
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
      settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'timeout racing success')
    ).toEqual({ settled: true, duplicate: true, successTerminal: true })
    expect(settleWorkerReport).toHaveBeenCalledOnce()
  })

  it('refuses to settle start_unknown so callers can wait for human recovery', () => {
    const settleWorkerReport = vi.fn()
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'start_unknown' })),
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

    expect(
      settleWorkflowAttemptOrchestrationFailed(orchestration, step, 'start still unknown')
    ).toEqual({ settled: false, duplicate: false, successTerminal: false })
    expect(settleWorkerReport).not.toHaveBeenCalled()
  })

  it('fails a starting worker without settleWorkerReport', () => {
    const failWorkerStart = vi.fn()
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'starting' })),
      getTask: vi.fn(() => ({ status: 'dispatched' })),
      getDispatchContextById: vi.fn(),
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
      duplicate: false,
      successTerminal: false
    })
    expect(failWorkerStart).toHaveBeenCalledWith('dispatch-1', 'workflow_engine', 'start failed')
  })
})
