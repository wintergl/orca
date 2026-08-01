import { writeFile, symlink } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import { reconcileLifecycleMessage } from '../orchestration/lifecycle-reconciliation'
import type { OrcaRuntimeService } from '../orca-runtime'
import { workflowReportPath } from './workflow-prompts'

export function queueCompletion(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  handle: string,
  paneKey: string,
  kind: 'produce' | 'review',
  invalidProduce = false,
  symlinkReportPath = false,
  omitReport = false,
  delayMs = 0,
  reviewVerdict: 'approve' | 'revise' | 'request-human' = 'approve'
): void {
  const reportPathPromise = activeWorkflowReportPath(db, handle)
  setTimeout(async () => {
    const reportPath = await reportPathPromise
    const report =
      kind === 'produce'
        ? {
            schema: 'workflow.completion/v1',
            outcome: 'succeeded',
            summary: 'Changed the implementation.',
            ...(invalidProduce
              ? {}
              : {
                  finalConclusionMarkdown: 'Changed `src/result.ts` and verified the output.'
                }),
            artifacts: [{ kind: 'code', locator: { paths: ['src/result.ts'] } }],
            validations: [{ command: 'test', result: 'passed', evidence: 'passed' }],
            unresolved: [],
            readyForNextStep: true
          }
        : {
            schema: 'workflow.review-result/v1',
            verdict: reviewVerdict,
            issues: [],
            unverified: [],
            conclusionMarkdown: 'The fixed Artifact Revision is approved.'
          }
    if (omitReport) {
      // The worker_done signal can race a failed report write; collection must fail closed.
    } else if (symlinkReportPath) {
      const target = `${reportPath}.target`
      await writeFile(target, JSON.stringify(report))
      await symlink(target, reportPath)
    } else {
      await writeFile(reportPath, JSON.stringify(report))
    }
    if (omitReport) {
      finishTask(runtime, db, { handle, paneKey, reportPath })
    }
  }, delayMs)
}

export function queueDecisionCompletion(
  db: OrchestrationDb,
  handle: string,
  invalid: boolean
): void {
  const reportPathPromise = activeWorkflowReportPath(db, handle)
  setTimeout(async () => {
    const reportPath = await reportPathPromise
    await writeFile(
      reportPath,
      JSON.stringify({
        schema: 'workflow.decision/v1',
        decision: invalid ? 'merge-now' : 'approve',
        conclusionMarkdown: 'Decision evidence was evaluated.'
      })
    )
  }, 0)
}

async function activeWorkflowReportPath(db: OrchestrationDb, handle: string): Promise<string> {
  const dispatch = db.getLatestDispatchForTerminal(handle)
  const worker = dispatch ? db.getWorkerDispatch(dispatch.id) : null
  const options = worker ? (JSON.parse(worker.start_options) as Record<string, unknown>) : null
  const runId = typeof options?.workflowRunId === 'string' ? options.workflowRunId : null
  const stepId = typeof options?.workflowStepRunId === 'string' ? options.workflowStepRunId : null
  if (!runId || !stepId) {
    throw new Error(`Active Workflow Dispatch for ${handle} is unavailable.`)
  }
  return workflowReportPath(runId, stepId)
}

function finishTask(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: {
    handle: string
    paneKey: string
    reportPath: string
  }
): void {
  const dispatch = db.getActiveDispatchForIdentity(params.handle, params.paneKey)
  if (!dispatch) {
    throw new Error(`Active Dispatch for ${params.handle} is unavailable.`)
  }
  const runId = workflowRunIdToOrchestrationRun(db, dispatch.task_id)
  const message = db.insertMessage({
    from: params.handle,
    to: `run:${runId}`,
    subject: 'Done',
    body: 'Completed the work with a bound report.',
    type: 'worker_done',
    senderPaneKey: params.paneKey,
    runId,
    payload: JSON.stringify({
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      filesModified: [],
      reportPath: params.reportPath
    })
  })
  reconcileLifecycleMessage(db, message, () => undefined)
  runtime.notifyMessageArrived?.(`run:${message.run_id}`, 'worker_done')
}

function workflowRunIdToOrchestrationRun(db: OrchestrationDb, taskId: string): string {
  const task = db.getTask(taskId)
  if (!task) {
    throw new Error(`Task ${taskId} is unavailable.`)
  }
  return task.run_id
}
