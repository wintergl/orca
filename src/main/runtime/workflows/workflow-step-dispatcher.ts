import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { assertTerminalAgentSendable } from '../rpc/terminal-agent-send-guard'
import type {
  WorkflowArtifactRevision,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import {
  bindWorkflowDispatchOwnershipIds,
  buildWorkflowLogicalExecutionKey,
  claimWorkflowDispatchOwnership
} from './workflow-dispatch-ownership-store'
import {
  buildDecisionPrompt,
  buildProducePrompt,
  buildReviewPrompt,
  workflowReportPath
} from './workflow-prompts'
import type { WorkflowStore } from './workflow-store'
import { workspaceGuardDigest, type WorkflowWorkspaceBaseline } from './workflow-workspace-snapshot'

export class WorkflowStepDispatcher {
  constructor(
    private readonly runtime: OrcaRuntimeService,
    private readonly store: WorkflowStore,
    private readonly orchestration: OrchestrationDb
  ) {}

  async dispatch(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    callerIdentity: string
  ): Promise<void> {
    const existingDispatch = step.dispatchId
      ? this.orchestration.getDispatchContextById(step.dispatchId)
      : null
    const existingWorker = step.dispatchId
      ? this.orchestration.getWorkerDispatch(step.dispatchId)
      : null
    // Why: the Agent may be working before its delayed Hook promotes the delivered Step to running.
    const isAlreadyDispatched =
      existingDispatch?.status === 'dispatched' && existingWorker?.state === 'ready'
    // Why: all fallible prechecks before creating external Orchestration identity.
    const target = await this.validateAssignment(run, step, {
      requireIdle: !isAlreadyDispatched
    })
    if (isAlreadyDispatched) {
      return
    }
    const prompt = this.buildPrompt(run, step)
    const processIncarnation = this.runtime.getTerminalProcessIncarnation(target.handle)
    if (!processIncarnation) {
      throw new WorkflowError(
        'workflow_agent_unavailable',
        'The assigned Agent process identity is unavailable.'
      )
    }
    await workflowReportPath(run.id, step.id)
    const orchestrationRunId =
      run.orchestrationRunId ??
      this.orchestration.createRun({
        objective: run.objective,
        coordinatorHandle: `workflow:${run.id}`,
        coordinatorPaneKey: `workflow:${run.id}`
      }).id
    if (!run.orchestrationRunId) {
      this.store.setOrchestrationRun(run.id, orchestrationRunId)
      run = this.store.showRun(run.id, callerIdentity)
      step = this.store.getStep(step.id) ?? step
    }
    const assignmentKey = step.assignment
      ? `${step.assignment.slotId}:${step.assignment.agentLifecycleId}`
      : 'engine'
    const ownership = claimWorkflowDispatchOwnership(this.store.persistenceDb, {
      runId: run.id,
      nodeId: step.nodeId,
      round: step.round,
      assignmentKey,
      stepRunId: step.id,
      attempt: step.attempt,
      taskId: step.taskId,
      dispatchId: step.dispatchId
    })
    if (!ownership.claimed) {
      throw new WorkflowError(
        'workflow_delivery_uncertain',
        `Logical execution ownership is held by step ${ownership.record?.stepRunId ?? 'unknown'}.`
      )
    }
    const task =
      step.taskId && this.orchestration.getTask(step.taskId)
        ? this.orchestration.getTask(step.taskId)!
        : this.orchestration.createTask({
            runId: orchestrationRunId,
            spec: `${step.nodeName}: ${run.objective}`,
            taskTitle: step.nodeName,
            displayName: `${run.templateName} · ${step.nodeName}`
          })
    const started = this.orchestration.createStartingWorkerDispatch({
      taskId: task.id,
      runtimeEpoch: this.runtime.getRuntimeId(),
      startOptions: {
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        worktree: run.workspace.id,
        terminal: target.handle,
        setup: 'not_applicable'
      }
    })
    // Why: bind external IDs immediately so any later failure can settle precisely.
    this.store.bindStepDispatchIdentity({
      runId: run.id,
      stepRunId: step.id,
      taskId: task.id,
      dispatchId: started.dispatch.id
    })
    if (
      !bindWorkflowDispatchOwnershipIds(this.store.persistenceDb, {
        logicalExecutionKey: buildWorkflowLogicalExecutionKey({
          runId: run.id,
          nodeId: step.nodeId,
          round: step.round,
          assignmentKey
        }),
        stepRunId: step.id,
        taskId: task.id,
        dispatchId: started.dispatch.id
      })
    ) {
      throw new WorkflowError(
        'workflow_delivery_uncertain',
        'Failed to bind Dispatch ownership after external create.'
      )
    }
    step = { ...step, taskId: task.id, dispatchId: started.dispatch.id, prompt }
    this.orchestration.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: target.handle,
      paneKey: step.assignment!.paneKey,
      processIncarnation,
      worktreeId: run.workspace.id,
      setupState: 'not_applicable',
      effects: [
        {
          kind: 'terminal',
          role: 'agent',
          action: 'reused_agent_terminal',
          id: target.handle
        }
      ]
    })
    this.store.markStepDelivering({
      runId: run.id,
      stepRunId: step.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      prompt
    })
    const reviewGuardDigest =
      step.nodeType === 'review'
        ? await workspaceGuardDigest(this.store.getBaseline(run.id) as WorkflowWorkspaceBaseline)
        : undefined
    const receipt = await this.runtime.sendTerminalAgentPrompt(target.handle, prompt, {
      beforeWrite: () => this.validateAssignmentNow(run, step, target.handle, processIncarnation),
      suffixFailureError: 'workflow_delivery_uncertain'
    })
    this.orchestration.markWorkerDispatchReady(started.dispatch.id, [
      {
        kind: 'terminal',
        role: 'agent',
        action: 'reused_agent_terminal',
        id: target.handle
      },
      { kind: 'dispatch_input', role: 'agent', id: target.handle, state: 'accepted' }
    ])
    this.store.markStepDelivered({
      runId: run.id,
      stepRunId: step.id,
      receipt: { deliveryId: step.deliveryId, ...receipt },
      reviewGuardDigest
    })
  }

  private buildPrompt(run: WorkflowRunRecord, step: WorkflowStepRunRecord): string {
    if (step.nodeType === 'review') {
      return buildReviewPrompt({
        run,
        step,
        artifact: this.inputArtifact(run, step)
      })
    }
    if (step.nodeType === 'decide') {
      return buildDecisionPrompt({ run, step })
    }
    return buildProducePrompt({ run, step })
  }

  private async validateAssignment(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    options: { requireIdle: boolean }
  ): Promise<{ handle: string }> {
    const assignment = step.assignment
    if (!assignment) {
      throw new WorkflowError('workflow_agent_unavailable', 'Step Agent assignment is missing.')
    }
    const resolved = this.runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
    if (
      resolved.worktreeId !== run.workspace.id ||
      assignment.executionHostId !== run.executionHostId
    ) {
      throw new WorkflowError(
        'workflow_context_mismatch',
        'Assigned Agent no longer belongs to the Workflow execution context.'
      )
    }
    if (options.requireIdle) {
      await assertTerminalAgentSendable({
        runtime: this.runtime,
        handle: resolved.handle,
        requireIdle: true,
        assertWritable: () => {
          this.runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
        }
      })
    }
    assertWorkflowAgentLifecycle(this.runtime, assignment, resolved.handle)
    return { handle: resolved.handle }
  }

  private validateAssignmentNow(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    handle: string,
    processIncarnation: string
  ): void {
    const assignment = step.assignment!
    const resolved = this.runtime.resolveTerminalPane(assignment.paneKey, assignment.worktreeId)
    if (
      resolved.handle !== handle ||
      resolved.worktreeId !== run.workspace.id ||
      this.runtime.getTerminalProcessIncarnation(handle) !== processIncarnation
    ) {
      throw new WorkflowError(
        'workflow_agent_unavailable',
        'Agent identity changed during delivery.'
      )
    }
    assertWorkflowAgentLifecycle(this.runtime, assignment, handle)
  }

  private inputArtifact(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord
  ): WorkflowArtifactRevision {
    const artifact = run.artifacts.find(
      (candidate) => candidate.id === step.inputArtifactRevisionId
    )
    if (!artifact || artifact.snapshotState !== 'frozen') {
      throw new WorkflowError(
        'workflow_artifact_unavailable',
        'Review input Artifact Revision is unavailable.'
      )
    }
    return artifact
  }
}
