import { describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import { failWorkflowEngineStep } from './workflow-engine-step-failure'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

describe('failWorkflowEngineStep orchestration terminal order', () => {
  it('settles task/dispatch before creating a decision retry attempt (P0-R1)', () => {
    const order: string[] = []
    const failDecision = vi.fn(() => {
      order.push('fail-decision')
      return null
    })
    const settleWorkerReport = vi.fn(() => {
      order.push('settle-orchestration')
      return { action: 'settled' as const, outcome: 'failed' as const, duplicate: false }
    })
    const store = {
      failDecision,
      failReviewer: vi.fn(),
      failRun: vi.fn()
    } as unknown as WorkflowStore
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'ready' })),
      getTask: vi.fn(() => ({ status: 'dispatched' })),
      getDispatchContextById: vi.fn(),
      failWorkerStart: vi.fn(),
      settleWorkerReport
    } as unknown as OrchestrationDb
    const step = {
      id: 'step-decision',
      nodeType: 'decide',
      taskId: 'task-decision',
      dispatchId: 'dispatch-decision',
      attempt: 1
    } as WorkflowStepRunRecord
    const run = { id: 'run-1', steps: [step] } as WorkflowRunRecord

    failWorkflowEngineStep(
      store,
      orchestration,
      run,
      step,
      new WorkflowError(
        'workflow_completion_incomplete',
        'The Decision conclusion must begin with approve, revise, request-human, or stop-at-review.'
      )
    )

    expect(order).toEqual(['settle-orchestration', 'fail-decision'])
    expect(failDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'workflow_decision_invalid',
        step
      })
    )
  })
})
