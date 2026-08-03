import type {
  WorkflowAgentAssignment,
  WorkflowResolutionOffer,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { WORKFLOW_REVIEW_ROUND_BUDGET_MAX } from '../../../shared/workflow-review-round-budget'
import { WorkflowError } from './workflow-error'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { buildWorkflowResolutionOffers } from './workflow-resolution-offers'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { workflowRecordId } from './workflow-runtime-records'
import { WorkflowStepControl } from './workflow-step-control'
import { applyHumanReviewDecision } from './workflow-transition-engine'
import {
  tryResolveWorkflowV2HumanOffer,
  validateWorkflowV2OfferInput
} from './workflow-run-control-v2-resolve'

export class WorkflowRunControl {
  private readonly steps: WorkflowStepControl

  constructor(
    private readonly store: WorkflowRuntimePersistence,
    private readonly showRun: (runId: string, callerIdentity: string) => WorkflowRunRecord
  ) {
    this.steps = new WorkflowStepControl(store)
  }

  pause(
    params: { runId: string; expectedVersion: number },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.current(params, mutation)
      if (run.status !== 'running') {
        throw conflict('Only a running Workflow can be paused.')
      }
      this.store.db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'paused', version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(run.id, run.version)
      this.store.insertEvent(run.id, 'run-paused', null, { actor: mutation.callerIdentity })
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  resume(
    params: { runId: string; expectedVersion: number },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.current(params, mutation)
      if (run.status !== 'paused') {
        throw conflict('Only a paused Workflow can be resumed.')
      }
      this.store.db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'running', version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(run.id, run.version)
      this.store.insertEvent(run.id, 'run-resumed', null, { actor: mutation.callerIdentity })
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  cancel(
    params: {
      runId: string
      expectedVersion: number
      reason: string
      confirmation: boolean
      runningAgentAction: 'preserve-running' | 'request-stop'
    },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.current(params, mutation)
      if (!params.confirmation || !params.reason.trim()) {
        throw new WorkflowError(
          'workflow_action_forbidden',
          'Cancel requires confirmation and a reason.'
        )
      }
      if (['completed', 'cancelled'].includes(run.status)) {
        return run
      }
      this.store.db
        .prepare(
          `UPDATE workflow_step_runs SET status = 'cancelled', completed_at = datetime('now'),
             updated_at = datetime('now')
           WHERE run_id = ? AND status IN ('queued', 'waiting-agent', 'delivering')`
        )
        .run(run.id)
      this.store.db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'cancelled', waiting_reason = NULL, completed_at = datetime('now'),
               failure_code = 'ended-by-user', failure_message = ?, recovery = NULL,
               version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(params.reason.trim(), run.id, run.version)
      this.store.insertEvent(run.id, 'run-cancelled', null, {
        actor: mutation.callerIdentity,
        reason: params.reason.trim(),
        runningAgentAction: params.runningAgentAction
      })
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  resolve(
    params: {
      runId: string
      offerId: string
      reason?: string
      reviewRoundBudget?: number
      confirmation: boolean
    },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.showRun(params.runId, mutation.callerIdentity)
      const offer = buildWorkflowResolutionOffers(run).find(
        (candidate) => candidate.id === params.offerId
      )
      if (!offer || offer.expectedRunVersion !== run.version) {
        throw conflict('Resolution Offer is stale, expired, or does not belong to this state.')
      }
      this.validateOfferInput(offer, params)
      if (
        tryResolveWorkflowV2HumanOffer({
          store: this.store,
          run,
          offer,
          reason: params.reason
        })
      ) {
        // V2 human route handled.
      } else if (offer.action === 'approve' || offer.action === 'revise') {
        applyHumanReviewDecision(this.store, run, offer.action, mutation.callerIdentity, {
          instructions: params.reason,
          reviewRoundBudget: params.reviewRoundBudget
        })
      } else if (offer.action === 'continue-round') {
        applyHumanReviewDecision(this.store, run, 'continue-round', mutation.callerIdentity)
      } else if (offer.action === 'end-workflow') {
        this.endAtReview(run, params.reason ?? 'Ended at Review')
      } else if (offer.action === 'retry-step') {
        this.steps.retry(run, offer.originDecisionStepId, params.reason ?? null)
      } else if (offer.action === 'retry-with-duplicate-risk') {
        // Why: delivery-uncertain leaves the origin step running; ordinary retry cannot apply.
        this.steps.retryWithDuplicateRisk(run, offer.originDecisionStepId, params.reason ?? null)
      } else if (offer.action !== 'view-evidence') {
        throw new WorkflowError(
          'workflow_action_forbidden',
          `Action ${offer.action} requires its dedicated recovery control.`
        )
      }
      const updated = this.showRun(run.id, mutation.callerIdentity)
      this.auditHumanAction(
        run,
        updated,
        offer,
        mutation,
        params.reason?.trim() || null,
        params.reviewRoundBudget ?? null
      )
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  retry(
    params: { runId: string; stepRunId: string; expectedVersion: number; reason?: string },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.current(params, mutation)
      this.steps.retry(run, params.stepRunId, params.reason?.trim() || null)
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  reassign(
    params: {
      runId: string
      stepRunId: string
      expectedVersion: number
      assignment: Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'>
      reason: string
    },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    return runWorkflowMutation(this.store.db, mutation, () => {
      const run = this.current(params, mutation)
      this.steps.reassign(run, params.stepRunId, params.assignment, params.reason)
      return this.showRun(run.id, mutation.callerIdentity)
    })
  }

  private current(
    params: { runId: string; expectedVersion: number },
    mutation: WorkflowMutation
  ): WorkflowRunRecord {
    const run = this.showRun(params.runId, mutation.callerIdentity)
    if (run.version !== params.expectedVersion) {
      throw conflict(`Workflow Run version ${params.expectedVersion} is stale.`)
    }
    return run
  }

  private validateOfferInput(
    offer: WorkflowResolutionOffer,
    params: { reason?: string; reviewRoundBudget?: number; confirmation: boolean }
  ): void {
    if (offer.requiresReason && !params.reason?.trim()) {
      throw new WorkflowError('workflow_action_forbidden', 'This action requires a reason.')
    }
    if (offer.requiresConfirmation && !params.confirmation) {
      throw new WorkflowError('workflow_action_forbidden', 'This action requires confirmation.')
    }
    if (validateWorkflowV2OfferInput(offer, params)) {
      return
    }
    if (
      offer.action === 'revise' &&
      params.reviewRoundBudget !== undefined &&
      (!Number.isInteger(params.reviewRoundBudget) ||
        params.reviewRoundBudget < 1 ||
        params.reviewRoundBudget > WORKFLOW_REVIEW_ROUND_BUDGET_MAX)
    ) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        `Review round budget must be between 1 and ${WORKFLOW_REVIEW_ROUND_BUDGET_MAX}.`
      )
    }
    if (offer.action !== 'revise' && params.reviewRoundBudget !== undefined) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Review round budget is valid only when returning for revision.'
      )
    }
  }

  private endAtReview(run: WorkflowRunRecord, reason: string): void {
    this.store.db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'cancelled', waiting_reason = NULL, failure_code = 'ended-at-review',
             failure_message = ?, completed_at = datetime('now'), version = version + 1,
             updated_at = datetime('now') WHERE id = ?`
      )
      .run(reason.trim(), run.id)
    this.store.insertEvent(run.id, 'run-cancelled', null, {
      reason: 'ended-at-review',
      detail: reason.trim()
    })
  }

  private auditHumanAction(
    before: WorkflowRunRecord,
    after: WorkflowRunRecord,
    offer: WorkflowResolutionOffer,
    mutation: WorkflowMutation,
    reason: string | null,
    reviewRoundBudget: number | null
  ): void {
    const aggregate = before.reviewAggregates.toReversed()[0]
    this.store.db
      .prepare(
        `INSERT INTO workflow_human_actions (
           id, run_id, offer_json, action, actor_identity, permission, reason,
           before_status, after_status, aggregate_id, artifact_revision_id, idempotency_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workflowRecordId('workflow_human_action'),
        before.id,
        JSON.stringify(offer),
        offer.action,
        mutation.callerIdentity,
        offer.requiredPermission,
        reason,
        before.status,
        after.status,
        aggregate?.id ?? null,
        before.resolutionContext?.artifactRevisionId ?? null,
        mutation.requestId
      )
    this.store.insertEvent(before.id, 'human-action', null, {
      offerId: offer.id,
      action: offer.action,
      actor: mutation.callerIdentity,
      reason,
      reviewRoundBudget,
      beforeStatus: before.status,
      afterStatus: after.status
    })
  }
}

function conflict(message: string): WorkflowError {
  return new WorkflowError('workflow_offer_conflict', message)
}
