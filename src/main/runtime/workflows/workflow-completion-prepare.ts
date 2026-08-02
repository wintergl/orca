import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowMessageSource,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type {
  WorkflowCompletionEnvelopeV1,
  WorkflowDecisionV1,
  WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { readWorkflowResultReport } from './workflow-completion-collector'
import { WorkflowError } from './workflow-error'
import { workflowReportPath } from './workflow-prompts'

const REPORT_WRITE_GRACE_MS = 250

export type WorkflowPreparedCompletion = {
  value: WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1
  source: WorkflowMessageSource
  digest: string
  sourceIdentity: string | null
  sourceReference: { reportPath: string; preparedAt: string }
  warnings: string[]
  filesModified: string[]
  reportPath: string
}

export type PrepareWorkflowStepResult =
  | { status: 'ready'; prepared: WorkflowPreparedCompletion }
  | { status: 'not-ready' }
  | {
      status: 'task-failed'
      code: 'workflow_completion_incomplete'
      message: string
    }

/**
 * Read and normalize a Step result once. Does not create receipts or settle Orchestration.
 */
export async function prepareWorkflowStepCompletion(params: {
  runtime: OrcaRuntimeService
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): Promise<PrepareWorkflowStepResult> {
  const { run, step } = params
  if (!step.taskId || !step.dispatchId || !step.assignment || !run.orchestrationRunId) {
    return { status: 'not-ready' }
  }
  const task = params.orchestration.getTask(step.taskId)
  if (!task) {
    return { status: 'not-ready' }
  }
  if (task.status === 'failed' || task.status === 'blocked') {
    return {
      status: 'task-failed',
      code: 'workflow_completion_incomplete' as const,
      message: `Orchestration Task ended as ${task.status}.`
    }
  }
  if (task.status !== 'dispatched' && task.status !== 'completed') {
    return { status: 'not-ready' }
  }

  const reportPath = await workflowReportPath(run.id, step.id)
  const reportStat = await lstat(reportPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!reportStat) {
    if (task.status === 'completed') {
      throw new WorkflowError(
        'workflow_completion_incomplete',
        'reportPath is missing after Orchestration completed.'
      )
    }
    return { status: 'not-ready' }
  }
  if (task.status === 'dispatched' && Date.now() - reportStat.mtimeMs < REPORT_WRITE_GRACE_MS) {
    return { status: 'not-ready' }
  }

  // Re-check lifecycle ownership before accepting a prepared success path.
  const resolved = params.runtime.resolveTerminalPane(
    step.assignment.paneKey,
    step.assignment.worktreeId
  )
  assertWorkflowAgentLifecycle(params.runtime, step.assignment, resolved.handle)

  const result = await readWorkflowResultReport({
    reportedPath: reportPath,
    expectedReportPath: reportPath,
    run,
    step
  })
  const filesModified = existingWorkerFilesModified(
    params.orchestration,
    run.orchestrationRunId,
    step.taskId,
    step.dispatchId
  )
  return {
    status: 'ready',
    prepared: {
      value: result.value,
      source: result.source,
      digest: sha256(result.raw),
      sourceIdentity: result.sourceIdentity,
      sourceReference: {
        reportPath,
        preparedAt: new Date().toISOString()
      },
      warnings: result.warnings,
      filesModified,
      reportPath
    }
  }
}

function existingWorkerFilesModified(
  orchestration: OrchestrationDb,
  orchestrationRunId: string,
  taskId: string,
  dispatchId: string
): string[] {
  const messages = orchestration.getRunMailboxHistory(orchestrationRunId, 500, ['worker_done'])
  for (const message of messages) {
    try {
      const payload = JSON.parse(message.payload ?? '{}') as Record<string, unknown>
      if (payload.taskId !== taskId || payload.dispatchId !== dispatchId) {
        continue
      }
      if (
        Array.isArray(payload.filesModified) &&
        payload.filesModified.every((item) => typeof item === 'string')
      ) {
        return payload.filesModified as string[]
      }
    } catch {
      // ignore malformed historical messages
    }
  }
  return []
}

function sha256(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function assertPreparedCompletionReady(
  prepared: WorkflowPreparedCompletion,
  step: WorkflowStepRunRecord
): void {
  if (step.nodeType === 'produce' && prepared.value.schema !== 'workflow.completion/v1') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce returned a non-Completion result.'
    )
  }
  if (
    step.nodeType === 'produce' &&
    prepared.value.schema === 'workflow.completion/v1' &&
    (prepared.value.outcome !== 'succeeded' || !prepared.value.readyForNextStep)
  ) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Produce did not return a ready successful Completion envelope.'
    )
  }
  if (step.nodeType === 'review' && prepared.value.schema !== 'workflow.review-result/v1') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Review returned a non-Review result.'
    )
  }
  if (step.nodeType === 'decide' && prepared.value.schema !== 'workflow.decision/v1') {
    throw new WorkflowError(
      'workflow_decision_invalid',
      'Decision Agent returned a non-Decision result.'
    )
  }
}
