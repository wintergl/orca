import { readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrchestrationDb } from '../orchestration/db'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { readWorkflowAgentFinalResponse } from './workflow-agent-final-response'
import { captureWorkflowAgentCompletion } from './workflow-agent-output-completion'
import { workflowReportPath } from './workflow-prompts'

vi.mock('./workflow-agent-final-response', () => ({
  readWorkflowAgentFinalResponse: vi.fn()
}))

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('Workflow Agent output completion', () => {
  it('writes the internal result from the normal final response after the Agent becomes idle', async () => {
    vi.mocked(readWorkflowAgentFinalResponse).mockResolvedValue({
      text: '已完成 SPEC，并新增 `docs/spec/next.md`。',
      sourceIdentity: 'transcript:test'
    })
    const run = {
      id: `workflow-run-auto-${Date.now()}`,
      orchestrationRunId: 'orchestration-run',
      executionHostId: 'local'
    } as WorkflowRunRecord
    const step = {
      id: 'step-produce',
      taskId: 'task-produce',
      dispatchId: 'dispatch-produce',
      nodeType: 'produce',
      prompt: '完成下一阶段优化',
      assignment: { paneKey: 'pane', worktreeId: 'workspace' }
    } as WorkflowStepRunRecord
    const reportPath = await workflowReportPath(run.id, step.id)
    cleanupPaths.push(dirname(reportPath))
    const runtime = {
      resolveTerminalPane: () => ({ handle: 'terminal' }),
      getTerminalAgentStatus: async () => ({
        handle: 'terminal',
        isRunningAgent: true,
        status: 'idle'
      })
    } as unknown as OrcaRuntimeService
    const orchestration = {
      getTask: () => ({ status: 'dispatched' })
    } as unknown as OrchestrationDb

    await expect(
      captureWorkflowAgentCompletion({ runtime, orchestration, run, step })
    ).resolves.toBe(true)
    await expect(readFile(reportPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      schema: 'workflow.completion/v1',
      outcome: 'succeeded',
      finalConclusionMarkdown: '已完成 SPEC，并新增 `docs/spec/next.md`。'
    })
  })

  it('uses done as the completion signal while preferring the complete transcript', async () => {
    vi.mocked(readWorkflowAgentFinalResponse).mockResolvedValue({
      text: '这是 transcript 中未截断的完整结果。',
      sourceIdentity: 'transcript:complete'
    })
    const run = {
      id: `workflow-run-hook-${Date.now()}`,
      orchestrationRunId: 'orchestration-run'
    } as WorkflowRunRecord
    const step = {
      id: 'step-hook',
      taskId: 'task-hook',
      dispatchId: 'dispatch-hook',
      nodeType: 'produce',
      prompt: '完成 SPEC',
      assignment: { paneKey: 'pane', worktreeId: 'workspace' }
    } as WorkflowStepRunRecord
    const reportPath = await workflowReportPath(run.id, step.id)
    cleanupPaths.push(dirname(reportPath))
    const getTerminalAgentStatus = vi.fn()
    const runtime = {
      resolveTerminalPane: () => ({ handle: 'terminal' }),
      getTerminalAgentStatus
    } as unknown as OrcaRuntimeService
    const orchestration = {
      getTask: () => ({ status: 'dispatched' })
    } as unknown as OrchestrationDb

    await expect(
      captureWorkflowAgentCompletion({
        runtime,
        orchestration,
        run,
        step,
        completionSignal: {
          text: 'Hook 预览',
          sourceIdentity: 'agent-status-hook:pane:1'
        }
      })
    ).resolves.toBe(true)
    expect(getTerminalAgentStatus).not.toHaveBeenCalled()
    await expect(readFile(reportPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      finalConclusionMarkdown: '这是 transcript 中未截断的完整结果。'
    })
  })
})
