import { lstat } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import { reconcileLifecycleMessage } from '../orchestration/lifecycle-reconciliation'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { readWorkflowResultReport } from './workflow-completion-collector'
import { WorkflowError } from './workflow-error'
import { workflowReportPath } from './workflow-prompts'

const REPORT_WRITE_GRACE_MS = 250

export async function completeWorkflowDispatchFromReport(params: {
  runtime: OrcaRuntimeService
  orchestration: OrchestrationDb
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): Promise<boolean> {
  const { run, step } = params
  if (!step.taskId || !step.dispatchId || !step.assignment || !run.orchestrationRunId) {
    return false
  }
  if (params.orchestration.getTask(step.taskId)?.status !== 'dispatched') {
    return false
  }
  const reportPath = await workflowReportPath(run.id, step.id)
  const reportStat = await lstat(reportPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!reportStat || Date.now() - reportStat.mtimeMs < REPORT_WRITE_GRACE_MS) {
    return false
  }
  const result = await readWorkflowResultReport({
    reportedPath: reportPath,
    expectedReportPath: reportPath,
    run,
    step
  })
  if (params.orchestration.getTask(step.taskId)?.status !== 'dispatched') {
    return false
  }
  const resolved = params.runtime.resolveTerminalPane(
    step.assignment.paneKey,
    step.assignment.worktreeId
  )
  assertWorkflowAgentLifecycle(params.runtime, step.assignment, resolved.handle)
  const outcome =
    result.value.schema === 'workflow.completion/v1' ? result.value.outcome : 'succeeded'
  const message = params.orchestration.insertMessage({
    from: resolved.handle,
    to: `run:${run.orchestrationRunId}`,
    subject: 'Workflow result ready',
    body: 'The assigned Workflow Step produced a validated structured result.',
    type: 'worker_done',
    senderPaneKey: step.assignment.paneKey,
    runId: run.orchestrationRunId,
    payload: JSON.stringify({
      taskId: step.taskId,
      dispatchId: step.dispatchId,
      outcome,
      filesModified: [],
      reportPath
    })
  })
  const reconciliation = reconcileLifecycleMessage(params.orchestration, message)
  if (reconciliation.action === 'rejected') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      `Workflow result completion was rejected: ${reconciliation.reason}`
    )
  }
  params.runtime.notifyMessageArrived?.(`run:${run.orchestrationRunId}`, 'worker_done')
  return reconciliation.action === 'completed' || reconciliation.action === 'failed'
}
