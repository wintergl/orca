import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import type { WorkflowMutation } from './workflow-mutation-ledger'
import { WorkflowStepDispatcher } from './workflow-step-dispatcher'
import type { WorkflowStore } from './workflow-store'
import { monitorWorkflowReviewSteps } from './workflow-review-runner'
import { requestStopWorkflowAgents } from './workflow-engine-agent-stop'
import { advancePendingWorkflow, isActiveWorkflowRunStatus } from './workflow-engine-pending'
import { failWorkflowEngineStep } from './workflow-engine-step-failure'
import { recordIgnoredLateCompletions } from './workflow-late-completion'
import {
  captureWorkspaceBaseline,
  type WorkflowWorkspaceBaseline
} from './workflow-workspace-snapshot'
import { prepareWorkflowStepCompletion } from './workflow-completion-prepare'
import { recoverWorkflowRuns } from './workflow-recovery-coordinator'
import { captureWorkflowAgentCompletion } from './workflow-agent-output-completion'
import { completePreparedWorkflowStep } from './workflow-engine-step-complete'
import {
  WorkflowAgentStatusHandler,
  type WorkflowAgentStatusEvent
} from './workflow-agent-status-handler'

const MONITOR_INTERVAL_MS = 500

export class WorkflowEngine {
  private readonly activeSteps = new Map<string, Promise<void>>()
  private readonly monitorTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dispatcher: WorkflowStepDispatcher
  private readonly agentStatuses: WorkflowAgentStatusHandler

  constructor(
    private readonly runtime: OrcaRuntimeService,
    private readonly store: WorkflowStore,
    private readonly orchestration: OrchestrationDb
  ) {
    this.dispatcher = new WorkflowStepDispatcher(runtime, store, orchestration)
    this.agentStatuses = new WorkflowAgentStatusHandler(
      runtime,
      store,
      orchestration,
      (runId, owner) => this.wakeMonitor(runId, owner)
    )
  }

  async handleAgentStatus(event: WorkflowAgentStatusEvent): Promise<boolean> {
    try {
      return await this.agentStatuses.handle(event)
    } catch (error) {
      const target = this.store.findActiveRunOwnerByDispatch({
        taskId: event.taskId,
        dispatchId: event.dispatchId
      })
      if (target) {
        const run = this.store.showRun(target.runId, target.ownerIdentity)
        const step = run.steps.find((candidate) => candidate.id === target.stepRunId)
        if (
          step &&
          ['queued', 'waiting-agent', 'delivering', 'running'].includes(step.status) &&
          isActiveWorkflowRunStatus(run.status)
        ) {
          this.failStep(run, step, error)
        }
      }
      throw error
    }
  }

  async start(
    runId: string,
    callerIdentity: string,
    mutation: WorkflowMutation
  ): Promise<WorkflowRunRecord> {
    const before = this.store.showRun(runId, callerIdentity)
    const baseline =
      before.status === 'ready'
        ? await captureWorkspaceBaseline(this.runtime, before)
        : (this.store.getBaseline(runId) as WorkflowWorkspaceBaseline | null)
    const receipt = this.store.beginRun({ runId, baseline }, mutation)
    const started = this.store.showRun(receipt.id, callerIdentity)
    if (started.status !== 'running') {
      return started
    }
    await this.ensureCurrentSteps(started, callerIdentity)
    this.scheduleMonitor(runId, callerIdentity)
    return this.store.showRun(runId, callerIdentity)
  }

  async recoverAll(): Promise<void> {
    await recoverWorkflowRuns({
      runtime: this.runtime,
      store: this.store,
      orchestration: this.orchestration,
      recoveryOwnerId: this.runtime.getRuntimeId(),
      resume: async (runId, callerIdentity) => {
        await this.resume(runId, callerIdentity)
      }
    })
  }

  async resume(runId: string, callerIdentity: string): Promise<WorkflowRunRecord> {
    let run = this.store.showRun(runId, callerIdentity)
    if (run.status !== 'running') {
      return run
    }
    run = advancePendingWorkflow(this.store, run, callerIdentity)
    await this.ensureCurrentSteps(run, callerIdentity)
    this.scheduleMonitor(runId, callerIdentity)
    return this.store.showRun(runId, callerIdentity)
  }

  stop(): void {
    for (const timer of this.monitorTimers.values()) {
      clearTimeout(timer)
    }
    this.monitorTimers.clear()
  }

  async requestStopRunningAgents(run: WorkflowRunRecord): Promise<void> {
    await requestStopWorkflowAgents(this.runtime, this.orchestration, run)
  }

  private async ensureCurrentSteps(run: WorkflowRunRecord, callerIdentity: string): Promise<void> {
    const steps = run.steps.filter(
      (candidate) =>
        candidate.nodeId === run.currentNodeId &&
        ['queued', 'waiting-agent', 'delivering', 'running'].includes(candidate.status)
    )
    await Promise.all(
      steps.map((step) =>
        step.status === 'running' ? Promise.resolve() : this.ensureStep(run, step, callerIdentity)
      )
    )
  }

  private async ensureStep(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    callerIdentity: string
  ): Promise<void> {
    if (step.status === 'running') {
      return
    }
    const pending = this.activeSteps.get(step.id)
    if (pending) {
      return pending
    }
    const operation = this.dispatcher
      .dispatch(run, step, callerIdentity)
      .then(() => this.agentStatuses.drainRun(run.id, callerIdentity))
      .catch((error) => {
        this.failStep(run, this.store.getStep(step.id) ?? step, error)
        if (step.nodeType !== 'review') {
          throw error
        }
      })
      .finally(() => {
        this.activeSteps.delete(step.id)
      })
    this.activeSteps.set(step.id, operation)
    return operation
  }

  private scheduleMonitor(
    runId: string,
    callerIdentity: string,
    delay = MONITOR_INTERVAL_MS
  ): void {
    if (this.monitorTimers.has(runId)) {
      return
    }
    const tick = async (): Promise<void> => {
      this.monitorTimers.delete(runId)
      let run: WorkflowRunRecord
      try {
        run = this.store.showRun(runId, callerIdentity)
      } catch {
        // Why: tests/shutdown may close the store while a timer is still armed.
        return
      }
      if (!isActiveWorkflowRunStatus(run.status)) {
        return
      }
      try {
        await this.monitorRun(run, callerIdentity)
      } catch (error) {
        try {
          const current = this.store.showRun(runId, callerIdentity)
          const step = current.steps
            .toReversed()
            .find(
              (candidate) =>
                candidate.nodeId === current.currentNodeId &&
                ['queued', 'waiting-agent', 'delivering', 'running'].includes(candidate.status)
            )
          if (step && isActiveWorkflowRunStatus(current.status)) {
            this.failStep(current, step, error)
          }
        } catch {
          return
        }
      }
      try {
        const current = this.store.showRun(runId, callerIdentity)
        if (isActiveWorkflowRunStatus(current.status)) {
          this.monitorTimers.set(
            runId,
            setTimeout(() => void tick(), MONITOR_INTERVAL_MS)
          )
        }
      } catch {
        // Store may already be closed during shutdown/tests.
      }
    }
    this.monitorTimers.set(
      runId,
      setTimeout(() => void tick(), delay)
    )
  }

  private wakeMonitor(runId: string, callerIdentity: string): void {
    const timer = this.monitorTimers.get(runId)
    if (timer) {
      clearTimeout(timer)
      this.monitorTimers.delete(runId)
    }
    this.scheduleMonitor(runId, callerIdentity, 0)
  }

  private async monitorRun(run: WorkflowRunRecord, callerIdentity: string): Promise<void> {
    recordIgnoredLateCompletions({ store: this.store, orchestration: this.orchestration, run })
    if (run.currentNodeId && run.status === 'running') {
      await this.ensureCurrentSteps(run, callerIdentity)
      run = this.store.showRun(run.id, callerIdentity)
    }
    const reviewSteps = run.steps.filter(
      (candidate) => candidate.nodeId === run.currentNodeId && candidate.nodeType === 'review'
    )
    if (reviewSteps.length > 0) {
      await monitorWorkflowReviewSteps({
        runtime: this.runtime,
        store: this.store,
        orchestration: this.orchestration,
        run,
        steps: reviewSteps,
        failStep: (step, error) => this.failStep(run, step, error)
      })
      return
    }
    const step = run.steps.find(
      (candidate) => candidate.nodeId === run.currentNodeId && candidate.status === 'running'
    )
    if (!step?.taskId || !step.dispatchId) {
      return
    }
    await captureWorkflowAgentCompletion({
      runtime: this.runtime,
      orchestration: this.orchestration,
      run,
      step
    })
    // prepare once → receive → worker_done/orch → workflow settle
    const prepared = await prepareWorkflowStepCompletion({
      runtime: this.runtime,
      orchestration: this.orchestration,
      run,
      step
    })
    if (prepared.status === 'not-ready') {
      return
    }
    if (prepared.status === 'task-failed') {
      this.failStep(run, step, new WorkflowError(prepared.code, prepared.message))
      return
    }
    const nextNodeId = await completePreparedWorkflowStep({
      store: this.store,
      orchestration: this.orchestration,
      runtime: this.runtime,
      run,
      step,
      prepared: prepared.prepared,
      callerIdentity
    })
    if (nextNodeId) {
      const next = this.store.showRun(run.id, callerIdentity)
      await this.ensureCurrentSteps({ ...next, currentNodeId: nextNodeId }, callerIdentity)
    }
  }

  private failStep(run: WorkflowRunRecord, step: WorkflowStepRunRecord, error: unknown): void {
    failWorkflowEngineStep(this.store, this.orchestration, run, step, error)
  }
}
