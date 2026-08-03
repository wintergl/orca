import type {
  WorkflowAgentAssignment,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import { retryWorkflowStepWithDuplicateRiskInTransaction } from './workflow-completion-retry-outbox'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { createAndPublishV2RetryStep } from './workflow-v2-retry'

export class WorkflowStepControl {
  constructor(private readonly store: WorkflowRuntimePersistence) {}

  retry(run: WorkflowRunRecord, stepRunId: string, reason: string | null): void {
    const step = this.requiredReplaceableStep(run, stepRunId)
    const retry = this.insertRetry(run, step, step.assignment)
    this.store.insertEvent(run.id, 'step-retried', retry.id, {
      retryOfStepRunId: step.id,
      attempt: retry.attempt,
      round: retry.round,
      reason
    })
  }

  /**
   * Fence running/uncertain steps and create a successor after operator risk accept.
   * Must run inside an existing Workflow DB transaction (e.g. resolveRun mutation).
   */
  retryWithDuplicateRisk(run: WorkflowRunRecord, stepRunId: string, reason: string | null): void {
    retryWorkflowStepWithDuplicateRiskInTransaction(this.store, run, stepRunId, reason)
  }

  reassign(
    run: WorkflowRunRecord,
    stepRunId: string,
    assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>,
    reason: string
  ): void {
    const step = this.requiredReplaceableStep(run, stepRunId)
    if (!step.assignment || !reason.trim()) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Reassign requires an existing role and a reason.'
      )
    }
    const slotId = step.assignment.slotId
    this.store.db
      .prepare(
        'DELETE FROM workflow_agent_assignments WHERE run_id = ? AND node_id = ? AND slot_id = ?'
      )
      .run(run.id, step.nodeId, slotId)
    this.store.db
      .prepare(
        `INSERT INTO workflow_agent_assignments (
           run_id, node_id, slot_id, worktree_id, execution_host_id, pane_key,
           agent_lifecycle_id, provider_session_id, runtime_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        step.nodeId,
        slotId,
        assignment.worktreeId,
        assignment.executionHostId,
        assignment.paneKey,
        assignment.agentLifecycleId,
        assignment.providerSessionId,
        assignment.runtimeAgent
      )
    const replacement = this.insertRetry(run, step, {
      ...assignment,
      nodeId: step.nodeId,
      slotId
    })
    this.store.insertEvent(run.id, 'agent-reassigned', replacement.id, {
      previousStepRunId: step.id,
      previousAgentLifecycleId: step.assignment.agentLifecycleId,
      agentLifecycleId: assignment.agentLifecycleId,
      reason: reason.trim()
    })
  }

  private insertRetry(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    assignment: WorkflowAgentAssignment | null
  ): WorkflowStepRunRecord {
    if (isWorkflowRunSnapshotV2(run.templateSnapshot)) {
      if (!assignment) {
        throw new WorkflowError('workflow_context_mismatch', 'V2 retry requires an assignment.')
      }
      return createAndPublishV2RetryStep(
        {
          db: this.store.db,
          getStep: (id) => this.store.getStep(id) ?? null,
          insertEvent: this.store.insertEvent.bind(this.store),
          insertStep: this.store.insertStep.bind(this.store),
          finishEngineStep: this.store.finishEngineStep.bind(this.store)
        },
        run,
        step,
        assignment
      )
    }
    const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === step.nodeId)
    if (!node) {
      throw new WorkflowError('workflow_transition_invalid', 'Retry node is unavailable.')
    }
    const retry = this.store.insertStep(
      run.id,
      node,
      assignment,
      step.inputArtifactRevisionId,
      'queued',
      step.round,
      step.attempt + 1
    )
    this.store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'running', current_node_id = ?, waiting_reason = NULL,
             resolution_context_json = NULL, failure_code = NULL, failure_message = NULL,
             recovery = NULL, completed_at = NULL, version = version + 1,
             updated_at = datetime('now') WHERE id = ?`
      )
      .run(step.nodeId, run.id)
    return retry
  }

  private requiredReplaceableStep(
    run: WorkflowRunRecord,
    stepRunId: string
  ): WorkflowStepRunRecord {
    const step = run.steps.find((candidate) => candidate.id === stepRunId)
    if (
      !step ||
      !['waiting-agent', 'failed', 'timed-out', 'completion-incomplete', 'succeeded'].includes(
        step.status
      )
    ) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Step is not eligible for retry or reassignment.'
      )
    }
    return step
  }
}
