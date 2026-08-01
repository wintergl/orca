import { randomUUID } from 'node:crypto'
import { lstat, rename, writeFile } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { readWorkflowAgentFinalResponse } from './workflow-agent-final-response'
import { buildAutomaticWorkflowResult } from './workflow-agent-result'
import { WorkflowError } from './workflow-error'
import { workflowReportPath } from './workflow-prompts'

export async function captureWorkflowAgentCompletion(params: {
  runtime: OrcaRuntimeService
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  completionSignal?: { text?: string; sourceIdentity: string }
}): Promise<boolean> {
  const { run, step } = params
  if (!step.taskId || !step.dispatchId || !step.assignment || !run.orchestrationRunId) {
    return false
  }
  if (params.orchestration.getTask(step.taskId)?.status !== 'dispatched') {
    return false
  }
  const reportPath = await workflowReportPath(run.id, step.id)
  if (await reportExists(reportPath)) {
    return false
  }
  const resolved = params.runtime.resolveTerminalPane(
    step.assignment.paneKey,
    step.assignment.worktreeId
  )
  if (!params.completionSignal) {
    const status = await params.runtime.getTerminalAgentStatus(resolved.handle)
    if (!status.isRunningAgent || status.status !== 'idle') {
      return false
    }
  }
  let response = await readFinalResponse(params.runtime, step)
  if (!response && params.completionSignal?.text?.trim()) {
    response = {
      text: params.completionSignal.text,
      sourceIdentity: params.completionSignal.sourceIdentity
    }
  }
  if (!response) {
    return false
  }
  const result = buildAutomaticWorkflowResult(step, response.text)
  await writeAtomicJson(reportPath, result)
  return true
}

async function readFinalResponse(
  runtime: OrcaRuntimeService,
  step: WorkflowStepRunRecord
): Promise<{ text: string; sourceIdentity: string } | null> {
  return readWorkflowAgentFinalResponse(runtime, step).catch((error) => {
    if (error instanceof WorkflowError && error.code === 'workflow_completion_incomplete') {
      return null
    }
    if (error instanceof OrchestrationError && error.code === 'transcript_required') {
      return null
    }
    throw error
  })
}

async function reportExists(path: string): Promise<boolean> {
  return Boolean(
    await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
  )
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  await rename(temporaryPath, path)
}
