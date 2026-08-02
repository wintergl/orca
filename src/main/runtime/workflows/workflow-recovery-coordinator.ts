import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { resumeWorkflowCompletionReconciliations } from './workflow-completion-failure-reconciler'
import { resumeWorkflowSuccessCompletions } from './workflow-completion-success-reconciler'
import { listUnsettledCompletionRunOwners } from './workflow-completion-reconciliation-queries'
import type { WorkflowStore } from './workflow-store'

type ResumeRecoveredRun = (runId: string, callerIdentity: string) => Promise<void>
type ReportRecoveryError = (
  identity: { runId: string; ownerIdentity: string },
  error: unknown
) => void

export async function recoverWorkflowRuns(params: {
  runtime: OrcaRuntimeService
  store: WorkflowStore
  orchestration: OrchestrationDb
  recoveryOwnerId: string
  resume: ResumeRecoveredRun
  onRunError?: ReportRecoveryError
}): Promise<void> {
  // Why: unsettled success/failure must resume even when the Run is already completed.
  await resumeUnsettledCompletionsAcrossRuns(params)
  for (const identity of params.store.listRecoverableRunOwners()) {
    try {
      if (!params.store.acquireRecoveryLease(identity.runId, params.recoveryOwnerId)) {
        continue
      }
      const run = params.store.showRun(identity.runId, identity.ownerIdentity)
      if (run.status !== 'running') {
        continue
      }
      await recoverRunningWorkflow(params, run, identity.ownerIdentity)
    } catch (error) {
      reportRecoveryError(params.onRunError, identity, error)
    }
  }
}

async function resumeUnsettledCompletionsAcrossRuns(
  params: Parameters<typeof recoverWorkflowRuns>[0]
): Promise<void> {
  const db = params.store.persistenceDb
  if (!db || typeof db.prepare !== 'function') {
    return
  }
  const identities = listUnsettledCompletionRunOwners(db)
  for (const identity of identities) {
    try {
      if (!params.store.acquireRecoveryLease(identity.runId, params.recoveryOwnerId)) {
        continue
      }
      const run = params.store.showRun(identity.runId, identity.ownerIdentity)
      resumeWorkflowCompletionReconciliations({
        store: params.store,
        orchestration: params.orchestration,
        run
      })
      await resumeWorkflowSuccessCompletions({
        store: params.store,
        orchestration: params.orchestration,
        runtime: params.runtime,
        run
      })
    } catch (error) {
      reportRecoveryError(params.onRunError, identity, error)
    }
  }
}

function reportRecoveryError(
  reporter: ReportRecoveryError | undefined,
  identity: { runId: string; ownerIdentity: string },
  error: unknown
): void {
  if (reporter) {
    reporter(identity, error)
    return
  }
  console.error(`[workflow] recovery skipped corrupt or unreadable Run ${identity.runId}`, error)
}

async function recoverRunningWorkflow(
  params: Parameters<typeof recoverWorkflowRuns>[0],
  run: WorkflowRunRecord,
  callerIdentity: string
): Promise<void> {
  // Why: finish mid-flight success/failure reconciliations before re-dispatch.
  resumeWorkflowCompletionReconciliations({
    store: params.store,
    orchestration: params.orchestration,
    run
  })
  await resumeWorkflowSuccessCompletions({
    store: params.store,
    orchestration: params.orchestration,
    runtime: params.runtime,
    run
  })
  run = params.store.showRun(run.id, callerIdentity)
  if (run.status === 'waiting-human') {
    return
  }
  const step = currentActiveStep(run)
  if (!step) {
    params.store.recordRunRecovered(run.id, null, { strategy: 'advance-persisted-state' })
    await params.resume(run.id, callerIdentity)
    return
  }
  if (step.status === 'queued' || step.status === 'waiting-agent') {
    if (step.taskId || step.dispatchId) {
      params.store.markRecoveryWaiting(
        run,
        step,
        'delivery-uncertain',
        'A prepared Step has partial external Dispatch identity.'
      )
      return
    }
    params.store.recordRunRecovered(run.id, step.id, { strategy: 'safe-prepared-delivery' })
    await params.resume(run.id, callerIdentity)
    return
  }
  const evidence = dispatchEvidence(params.orchestration, run, step)
  if (!evidence.valid) {
    params.store.markRecoveryWaiting(run, step, 'delivery-uncertain', evidence.message)
    return
  }
  if (
    evidence.taskStatus === 'dispatched' &&
    !hasCurrentLifecycle(params.runtime, run, step, evidence.processIncarnation)
  ) {
    params.store.markRecoveryWaiting(
      run,
      step,
      'lifecycle-mismatch',
      'The assigned Pane, process incarnation, or Provider Session changed during restart.'
    )
    return
  }
  if (step.status === 'delivering') {
    if (!evidence.workerAccepted) {
      params.store.markRecoveryWaiting(
        run,
        step,
        'delivery-uncertain',
        'The Dispatch exists, but the Worker has no accepted delivery receipt.'
      )
      return
    }
    params.store.markStepRunning({
      runId: run.id,
      stepRunId: step.id,
      receipt: { recovery: true, dispatchId: step.dispatchId }
    })
  }
  params.store.recordRunRecovered(run.id, step.id, {
    strategy: evidence.taskStatus === 'completed' ? 'collect-completion' : 'monitor-dispatch',
    taskId: step.taskId,
    dispatchId: step.dispatchId
  })
  await params.resume(run.id, callerIdentity)
}

function currentActiveStep(run: WorkflowRunRecord): WorkflowStepRunRecord | null {
  return (
    run.steps
      .toReversed()
      .find(
        (step) =>
          step.nodeId === run.currentNodeId &&
          ['queued', 'waiting-agent', 'delivering', 'running'].includes(step.status)
      ) ?? null
  )
}

function dispatchEvidence(
  orchestration: OrchestrationDb,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): {
  valid: boolean
  message: string
  taskStatus: string | null
  workerAccepted: boolean
  processIncarnation: string | null
} {
  if (!run.orchestrationRunId || !step.taskId || !step.dispatchId) {
    return invalidEvidence('Dispatch identity is incomplete.')
  }
  const task = orchestration.getTask(step.taskId)
  const dispatch = orchestration.getDispatchContextById(step.dispatchId)
  const worker = orchestration.getWorkerDispatch(step.dispatchId)
  if (
    !task ||
    !dispatch ||
    !worker ||
    task.run_id !== run.orchestrationRunId ||
    dispatch.run_id !== run.orchestrationRunId ||
    dispatch.task_id !== task.id ||
    worker.dispatch_id !== dispatch.id
  ) {
    return invalidEvidence('Persisted Workflow and Orchestration identities do not match.')
  }
  const supportedTaskState = task.status === 'dispatched' || task.status === 'completed'
  return {
    valid: supportedTaskState,
    message: supportedTaskState ? '' : `Orchestration Task is ${task.status}.`,
    taskStatus: task.status,
    workerAccepted: ['ready', 'succeeded'].includes(worker.state),
    processIncarnation: dispatch.process_incarnation
  }
}

function invalidEvidence(message: string) {
  return {
    valid: false,
    message,
    taskStatus: null,
    workerAccepted: false,
    processIncarnation: null
  }
}

function hasCurrentLifecycle(
  runtime: OrcaRuntimeService,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  processIncarnation: string | null
): boolean {
  const assignment = step.assignment
  if (!assignment || assignment.executionHostId !== run.executionHostId) {
    return false
  }
  try {
    const resolved = runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
    const providerSession =
      runtime.getExactWorkerProviderSession(resolved.handle, 0)?.providerSession.id ?? null
    assertWorkflowAgentLifecycle(runtime, assignment, resolved.handle)
    return (
      resolved.worktreeId === run.workspace.id &&
      runtime.getTerminalProcessIncarnation(resolved.handle) === processIncarnation &&
      providerSession === assignment.providerSessionId
    )
  } catch {
    return false
  }
}
