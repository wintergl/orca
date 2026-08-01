import { describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WorkflowEngine } from './workflow-engine'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import { captureWorkflowAgentCompletion } from './workflow-agent-output-completion'

vi.mock('./workflow-agent-lifecycle-authority', () => ({
  assertWorkflowAgentLifecycle: vi.fn()
}))
vi.mock('./workflow-agent-output-completion', () => ({
  captureWorkflowAgentCompletion: vi.fn()
}))

describe('WorkflowEngine Agent status failure', () => {
  it('fails closed instead of leaving a Decision Step running after completion parsing fails', async () => {
    const step = {
      id: 'step-decision',
      nodeId: 'spec-decide',
      nodeType: 'decide',
      status: 'running',
      taskId: 'task-decision',
      dispatchId: 'dispatch-decision',
      assignment: {
        paneKey: 'pane-decision',
        agentLifecycleId: 'lifecycle-decision',
        worktreeId: 'workspace-a'
      }
    } as WorkflowStepRunRecord
    const run = {
      id: 'run-decision',
      status: 'running',
      steps: [step]
    } as WorkflowRunRecord
    const failDecision = vi.fn()
    const settleWorkerReport = vi.fn(() => ({
      action: 'settled' as const,
      outcome: 'failed' as const,
      duplicate: false
    }))
    const store = {
      findActiveRunOwnerByDispatch: vi.fn(() => ({
        runId: run.id,
        ownerIdentity: 'user-a',
        stepRunId: step.id
      })),
      getStep: vi.fn(() => step),
      showRun: vi.fn(() => run),
      failDecision
    } as unknown as WorkflowStore
    const orchestration = {
      getTask: vi.fn(() => ({ status: 'dispatched' })),
      getWorkerDispatch: vi.fn(() => ({ state: 'ready' })),
      getDispatchContextById: vi.fn(),
      failWorkerStart: vi.fn(),
      settleWorkerReport
    } as unknown as OrchestrationDb
    vi.mocked(captureWorkflowAgentCompletion).mockRejectedValueOnce(
      new WorkflowError(
        'workflow_completion_incomplete',
        'The Decision conclusion must begin with a verdict.'
      )
    )
    const runtime = {
      resolveTerminalPane: vi.fn(() => ({ handle: 'terminal-decision' }))
    } as unknown as OrcaRuntimeService
    const engine = new WorkflowEngine(runtime, store, orchestration)

    await expect(
      engine.handleAgentStatus({
        state: 'done',
        paneKey: 'pane-decision',
        worktreeId: 'workspace-a',
        agentLifecycleId: 'lifecycle-decision',
        taskId: 'task-decision',
        dispatchId: 'dispatch-decision',
        receivedAt: Date.now(),
        lastAssistantMessage: 'ambiguous conclusion'
      })
    ).rejects.toThrow('must begin with a verdict')
    expect(settleWorkerReport).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-decision',
        dispatchId: 'dispatch-decision',
        outcome: 'failed'
      })
    )
    expect(failDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        step,
        code: 'workflow_decision_invalid'
      })
    )
  })
})
