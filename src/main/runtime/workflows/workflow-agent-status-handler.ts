import type { AgentStatusState } from '../../../shared/agent-status-types'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { captureWorkflowAgentCompletion } from './workflow-agent-output-completion'
import { completeWorkflowDispatchFromReport } from './workflow-report-completion'
import type { WorkflowStore } from './workflow-store'

export type WorkflowAgentStatusEvent = {
  state: AgentStatusState
  paneKey: string
  worktreeId?: string
  agentLifecycleId: string
  taskId: string
  dispatchId: string
  receivedAt: number
  lastAssistantMessage?: string
  interrupted?: boolean
}

type PendingStatus = {
  working?: WorkflowAgentStatusEvent
  done?: WorkflowAgentStatusEvent
}

export class WorkflowAgentStatusHandler {
  private readonly pendingByDispatch = new Map<string, PendingStatus>()
  private readonly operations = new Map<string, Promise<boolean>>()

  constructor(
    private readonly runtime: OrcaRuntimeService,
    private readonly store: WorkflowStore,
    private readonly orchestration: OrchestrationDb,
    private readonly wakeRun: (runId: string, ownerIdentity: string) => void
  ) {}

  handle(event: WorkflowAgentStatusEvent): Promise<boolean> {
    if (event.state !== 'working' && event.state !== 'done') {
      return Promise.resolve(false)
    }
    const target = this.store.findActiveRunOwnerByDispatch({
      taskId: event.taskId,
      dispatchId: event.dispatchId
    })
    if (!target) {
      return Promise.resolve(false)
    }
    const step = this.store.getStep(target.stepRunId)
    if (!step || !this.matchesAssignment(step, event)) {
      return Promise.resolve(false)
    }
    const pending = this.pendingByDispatch.get(event.dispatchId) ?? {}
    pending[event.state] = event
    this.pendingByDispatch.set(event.dispatchId, pending)
    return this.enqueue(event.dispatchId, () =>
      this.applyPending(target.runId, target.ownerIdentity, target.stepRunId)
    )
  }

  async drainRun(runId: string, ownerIdentity: string): Promise<void> {
    const run = this.store.showRun(runId, ownerIdentity)
    await Promise.all(
      run.steps.flatMap((step) =>
        step.dispatchId && this.pendingByDispatch.has(step.dispatchId)
          ? [this.enqueue(step.dispatchId, () => this.applyPending(runId, ownerIdentity, step.id))]
          : []
      )
    )
  }

  private enqueue(dispatchId: string, operation: () => Promise<boolean>): Promise<boolean> {
    const previous = this.operations.get(dispatchId) ?? Promise.resolve(false)
    const current = previous.catch(() => false).then(operation)
    this.operations.set(dispatchId, current)
    void current.then(
      () => this.clearOperation(dispatchId, current),
      () => this.clearOperation(dispatchId, current)
    )
    return current
  }

  private clearOperation(dispatchId: string, operation: Promise<boolean>): void {
    if (this.operations.get(dispatchId) === operation) {
      this.operations.delete(dispatchId)
    }
  }

  private async applyPending(
    runId: string,
    ownerIdentity: string,
    stepRunId: string
  ): Promise<boolean> {
    let run = this.store.showRun(runId, ownerIdentity)
    let step = run.steps.find((candidate) => candidate.id === stepRunId)
    if (
      !step?.dispatchId ||
      !step.assignment ||
      (run.status !== 'running' && run.status !== 'paused')
    ) {
      return false
    }
    const pending = this.pendingByDispatch.get(step.dispatchId)
    if (!pending || !this.matchesAssignment(step, pending.working ?? pending.done)) {
      return false
    }
    this.assertCurrentLifecycle(step)
    if (pending.working && step.status === 'delivering' && step.deliveryState === 'delivered') {
      this.store.markStepWorking({
        runId,
        stepRunId,
        source: 'agent-status-hook'
      })
      delete pending.working
      run = this.store.showRun(runId, ownerIdentity)
      step = run.steps.find((candidate) => candidate.id === stepRunId)
    }
    if (!step || !pending.done || step.status !== 'running') {
      this.clearPending(step?.dispatchId ?? null, pending)
      return true
    }
    if (pending.done.interrupted) {
      delete pending.done
      this.clearPending(step.dispatchId, pending)
      return true
    }
    await captureWorkflowAgentCompletion({
      runtime: this.runtime,
      orchestration: this.orchestration,
      run,
      step,
      completionSignal: {
        text: pending.done.lastAssistantMessage,
        sourceIdentity: `agent-status-hook:${pending.done.paneKey}:${pending.done.receivedAt}`
      }
    })
    await completeWorkflowDispatchFromReport({
      runtime: this.runtime,
      orchestration: this.orchestration,
      run,
      step
    })
    delete pending.done
    this.clearPending(step.dispatchId, pending)
    this.wakeRun(runId, ownerIdentity)
    return true
  }

  private clearPending(dispatchId: string | null, pending: PendingStatus): void {
    if (dispatchId && !pending.working && !pending.done) {
      this.pendingByDispatch.delete(dispatchId)
    }
  }

  private matchesAssignment(
    step: WorkflowStepRunRecord,
    event: WorkflowAgentStatusEvent | undefined
  ): boolean {
    return Boolean(
      event &&
      step.taskId === event.taskId &&
      step.dispatchId === event.dispatchId &&
      step.assignment?.paneKey === event.paneKey &&
      step.assignment.agentLifecycleId === event.agentLifecycleId &&
      (!event.worktreeId || step.assignment.worktreeId === event.worktreeId)
    )
  }

  private assertCurrentLifecycle(step: WorkflowStepRunRecord): void {
    const assignment = step.assignment!
    const resolved = this.runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
    assertWorkflowAgentLifecycle(this.runtime, assignment, resolved.handle)
  }
}
