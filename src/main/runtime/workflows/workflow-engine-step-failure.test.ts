import { describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import { failWorkflowEngineStep } from './workflow-engine-step-failure'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import * as reconciler from './workflow-completion-failure-reconciler'

vi.mock('./workflow-completion-failure-reconciler', () => ({
  reconcileWorkflowStepFailure: vi.fn(() => ({
    receiptId: 'receipt-1',
    retryStep: null,
    waitingHuman: false,
    duplicate: false
  }))
}))

describe('failWorkflowEngineStep', () => {
  it('delegates failure handling to the durable completion reconciler', () => {
    const store = {} as WorkflowStore
    const orchestration = {} as OrchestrationDb
    const step = { id: 'step-decision', nodeType: 'decide' } as WorkflowStepRunRecord
    const run = { id: 'run-1', steps: [step] } as WorkflowRunRecord
    const error = new WorkflowError('workflow_completion_incomplete', 'bad decision')

    failWorkflowEngineStep(store, orchestration, run, step, error)

    expect(reconciler.reconcileWorkflowStepFailure).toHaveBeenCalledWith({
      store,
      orchestration,
      run,
      step,
      error
    })
  })
})
