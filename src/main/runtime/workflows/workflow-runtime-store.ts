import type Database from '../../sqlite/sync-database'
import type {
  WorkflowAgentAssignment,
  WorkflowArtifactRevision,
  WorkflowMessageSource,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowDecisionV1 } from '../../../shared/workflow-result-schema'
import { WorkflowError } from './workflow-error'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { WorkflowRunControl } from './workflow-run-control'
import { completeWorkflowReview, type WorkflowReviewCompletion } from './workflow-review-fan-in'
import { failWorkflowReviewer } from './workflow-review-failure'
import { failWorkflowDecision } from './workflow-decision-failure'
import {
  failWorkflowRun,
  markWorkflowArtifactDrifted
} from './workflow-runtime-terminal-transitions'
import {
  advanceProduceTransition,
  advanceReviewAggregate,
  applyPersistedDecision,
  finishAgentDecision
} from './workflow-transition-engine'
import { claimWorkflowResultReceipt } from './workflow-result-receipt'
import {
  markWorkflowRecoveryWaiting,
  recordWorkflowRunRecovered,
  type WorkflowRecoveryWaitingReason
} from './workflow-recovery-state'
import {
  markWorkflowStepDelivered,
  markWorkflowStepDelivering,
  markWorkflowStepWorking
} from './workflow-delivery-store'

export class WorkflowRuntimeStore extends WorkflowRuntimePersistence {
  private readonly control: WorkflowRunControl

  constructor(
    db: Database.Database,
    private readonly showRunRecord: (runId: string, callerIdentity: string) => WorkflowRunRecord
  ) {
    super(db)
    this.control = new WorkflowRunControl(this, showRunRecord)
  }

  markRecoveryWaiting(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    reason: WorkflowRecoveryWaitingReason,
    message: string
  ): void {
    markWorkflowRecoveryWaiting(this, run, step, reason, message)
  }

  recordRunRecovered(runId: string, stepRunId: string | null, payload: unknown): void {
    recordWorkflowRunRecovered(this, runId, stepRunId, payload)
  }

  pauseRun(...params: Parameters<WorkflowRunControl['pause']>): WorkflowRunRecord {
    return this.control.pause(...params)
  }

  resumeRun(...params: Parameters<WorkflowRunControl['resume']>): WorkflowRunRecord {
    return this.control.resume(...params)
  }

  cancelRun(...params: Parameters<WorkflowRunControl['cancel']>): WorkflowRunRecord {
    return this.control.cancel(...params)
  }

  resolveRun(...params: Parameters<WorkflowRunControl['resolve']>): WorkflowRunRecord {
    return this.control.resolve(...params)
  }

  retryStep(...params: Parameters<WorkflowRunControl['retry']>): WorkflowRunRecord {
    return this.control.retry(...params)
  }

  reassignStep(...params: Parameters<WorkflowRunControl['reassign']>): WorkflowRunRecord {
    return this.control.reassign(...params)
  }

  beginRun(
    params: { runId: string; baseline: unknown },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.db, mutation, () => {
      const run = this.showRunRecord(params.runId, mutation.callerIdentity)
      if (run.status === 'running' || run.status === 'completed' || run.status === 'failed') {
        return run
      }
      if (run.status !== 'ready') {
        throw new WorkflowError('workflow_preflight_failed', 'Only a ready Run can start.')
      }
      const produce = run.templateSnapshot.nodes.find(
        (node) => node.id === run.templateSnapshot.entryNodeId && node.type === 'produce'
      )
      if (!produce) {
        throw new WorkflowError(
          'workflow_transition_invalid',
          'Workflow entry node must be a Produce node.'
        )
      }
      const entryTransition = run.templateSnapshot.transitions.find(
        (transition) => transition.from === produce.id && transition.when === 'step:succeeded'
      )
      const review = run.templateSnapshot.nodes.find(
        (node) => node.id === entryTransition?.to && node.type === 'review'
      )
      if (review?.type !== 'review') {
        throw new WorkflowError(
          'workflow_transition_invalid',
          'Workflow entry Produce must transition to Review.'
        )
      }
      const produceAssignments = assignmentsForNode(run, produce.id)
      const reviewAssignments = assignmentsForNode(run, review.id)
      const minimumReviewers = review.reviewPolicy.minReviewers
      if (produceAssignments.length !== 1 || reviewAssignments.length < minimumReviewers) {
        throw new WorkflowError(
          'workflow_m3_scope_unsupported',
          'M3 requires one Produce Agent and the configured minimum Reviewers.'
        )
      }
      const step = this.insertStep(run.id, produce, produceAssignments[0]!, null)
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'running', current_node_id = ?, baseline_json = ?,
               failure_code = NULL, failure_message = NULL, recovery = NULL,
               started_at = datetime('now'), completed_at = NULL,
               version = version + 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(produce.id, JSON.stringify(params.baseline), run.id)
      this.insertEvent(run.id, 'run-started', step.id, { nodeId: produce.id })
      return this.showRunRecord(run.id, mutation.callerIdentity)
    })
  }

  setOrchestrationRun(runId: string, orchestrationRunId: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET orchestration_run_id = ?, version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND orchestration_run_id IS NULL`
        )
        .run(orchestrationRunId, runId)
      this.db
        .prepare(
          `UPDATE workflow_step_runs SET orchestration_run_id = ?, updated_at = datetime('now')
           WHERE run_id = ? AND orchestration_run_id IS NULL`
        )
        .run(orchestrationRunId, runId)
    })
  }

  markDelivering(params: {
    runId: string
    stepRunId: string
    taskId: string
    dispatchId: string
    prompt: string
  }): void {
    markWorkflowStepDelivering(this, params)
  }

  markDelivered(params: {
    runId: string
    stepRunId: string
    receipt: unknown
    reviewGuardDigest?: string
  }): void {
    markWorkflowStepDelivered(this, params)
  }

  markWorking(params: {
    runId: string
    stepRunId: string
    source: 'agent-status-hook' | 'recovery'
  }): void {
    markWorkflowStepWorking(this, params)
  }

  markRunning(params: {
    runId: string
    stepRunId: string
    receipt: unknown
    reviewGuardDigest?: string
  }): void {
    this.markDelivered(params)
    this.markWorking({ ...params, source: 'recovery' })
  }

  completeProduce(params: {
    run: WorkflowRunRecord
    step: WorkflowStepRunRecord
    envelope: unknown
    conclusionMarkdown: string
    source: WorkflowMessageSource
    digest: string
    sourceIdentity: string | null
    sourceReference: unknown
    warnings: string[]
    artifact: WorkflowArtifactRevision
    advance?: boolean
  }): WorkflowStepRunRecord[] {
    return this.transaction(() => {
      const persisted = this.getStep(params.step.id)
      if (persisted?.status === 'succeeded') {
        return []
      }
      claimWorkflowResultReceipt(
        this,
        params.run.id,
        params.step.id,
        'completion',
        params.sourceReference
      )
      this.insertResultMessage({
        runId: params.run.id,
        stepRunId: params.step.id,
        kind: 'completion',
        content: params.envelope,
        markdown: params.conclusionMarkdown,
        source: params.source,
        digest: params.digest,
        sourceIdentity: params.sourceIdentity,
        sourceReference: params.sourceReference
      })
      this.finishStep({
        stepRunId: params.step.id,
        envelope: params.envelope,
        conclusionMarkdown: params.conclusionMarkdown,
        source: params.source,
        digest: params.digest,
        sourceIdentity: params.sourceIdentity,
        warnings: params.warnings,
        outputArtifactRevisionId: params.artifact.id
      })
      this.insertEvent(params.run.id, 'step-completed', params.step.id, {
        nodeId: params.step.nodeId,
        artifactRevisionId: params.artifact.id
      })
      if (params.advance === false) {
        return []
      }
      return advanceProduceTransition(this, params.run, params.step, params.artifact)
    })
  }

  completeReview(params: WorkflowReviewCompletion) {
    return completeWorkflowReview(this, params)
  }

  advanceProduce(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    artifact: WorkflowArtifactRevision
  ): WorkflowStepRunRecord[] {
    return this.transaction(() => advanceProduceTransition(this, run, step, artifact))
  }

  advanceAggregate(
    run: WorkflowRunRecord,
    aggregate: WorkflowRunRecord['reviewAggregates'][number]
  ): WorkflowStepRunRecord | null {
    return this.transaction(() => advanceReviewAggregate(this, run, aggregate))
  }

  completeDecision(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    aggregate: WorkflowRunRecord['reviewAggregates'][number],
    collected: {
      result: WorkflowDecisionV1
      source: WorkflowMessageSource
      digest: string
      sourceIdentity: string | null
      sourceReference: unknown
      warnings: string[]
    },
    apply = true
  ): void {
    this.transaction(() => {
      if (this.getStep(step.id)?.status === 'succeeded') {
        return
      }
      claimWorkflowResultReceipt(this, run.id, step.id, 'decision', collected.sourceReference)
      finishAgentDecision(this, run, step, aggregate, collected, apply)
    })
  }

  advancePersistedDecision(
    run: WorkflowRunRecord,
    decision: WorkflowRunRecord['decisions'][number]
  ): void {
    this.transaction(() => applyPersistedDecision(this, run, decision))
  }

  failReviewer(params: Parameters<typeof failWorkflowReviewer>[1]): WorkflowStepRunRecord | null {
    return failWorkflowReviewer(this, params)
  }

  failDecision(params: Parameters<typeof failWorkflowDecision>[1]): WorkflowStepRunRecord | null {
    return failWorkflowDecision(this, params)
  }

  fail(params: Parameters<typeof failWorkflowRun>[1]): void {
    failWorkflowRun(this, params)
  }

  markArtifactDrifted(runId: string, stepRunId: string, artifactRevisionId: string): void {
    markWorkflowArtifactDrifted(this, runId, stepRunId, artifactRevisionId)
  }
}

function assignmentsForNode(run: WorkflowRunRecord, nodeId: string): WorkflowAgentAssignment[] {
  return run.assignments.filter((assignment) => assignment.nodeId === nodeId)
}
