import { createHash } from 'node:crypto'
import type {
  WorkflowResolutionAction,
  WorkflowResolutionOffer,
  WorkflowRunRecord,
  WorkflowWaitingReason
} from '../../../shared/workflow-definition-types'

const OFFER_TTL_MS = 24 * 60 * 60 * 1_000

const ACTIONS_BY_REASON: Record<WorkflowWaitingReason, WorkflowResolutionAction[]> = {
  'review-request-human': ['view-evidence', 'approve', 'revise', 'end-workflow'],
  'review-revision-required': ['view-evidence', 'approve', 'revise', 'end-workflow'],
  'review-conflict': ['view-evidence', 'approve', 'revise', 'retry-step', 'end-workflow'],
  'review-limit-reached': ['view-evidence', 'revise', 'continue-round', 'approve', 'end-workflow'],
  'agent-unavailable': ['view-evidence', 'reassign-agent', 'retry-step', 'end-workflow'],
  'lifecycle-mismatch': ['view-evidence', 'reassign-agent', 'end-workflow'],
  'permission-required': ['view-evidence', 'resolve-permission', 'retry-step', 'end-workflow'],
  'transport-disconnected': [
    'view-evidence',
    'wait-for-reconnect',
    'reassign-agent',
    'end-workflow'
  ],
  'reviewer-retry-exhausted': ['view-evidence', 'retry-step', 'reassign-agent', 'end-workflow'],
  'decision-invalid': [
    'view-evidence',
    'retry-step',
    'reassign-agent',
    'approve',
    'revise',
    'end-workflow'
  ],
  'delivery-uncertain': [
    'view-evidence',
    'wait-for-reconnect',
    'retry-with-duplicate-risk',
    'end-workflow'
  ],
  'artifact-unavailable': ['view-evidence', 'regenerate-artifact', 'retry-step', 'end-workflow'],
  'artifact-drifted': ['view-evidence', 'regenerate-artifact', 'end-workflow'],
  'completion-incomplete': ['view-evidence', 'retry-step', 'reassign-agent', 'end-workflow']
}

export function buildWorkflowResolutionOffers(run: WorkflowRunRecord): WorkflowResolutionOffer[] {
  const reason = run.waitingReason
  const context = run.resolutionContext
  if (!reason || !context || !['waiting-human', 'review-limit-reached'].includes(run.status)) {
    return []
  }
  const expiresAtMs = Date.parse(run.updatedAt) + OFFER_TTL_MS
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return []
  }
  const expiresAt = new Date(expiresAtMs).toISOString()
  return configuredActions(run, reason).map((action) => {
    const resolutionTransitionId = transitionIdForAction(run, action)
    const seed = JSON.stringify({
      runId: run.id,
      version: run.version,
      reason,
      action,
      resolutionTransitionId,
      expiresAt
    })
    return {
      id: `workflow_offer_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`,
      runId: run.id,
      waitingReason: reason,
      action,
      originDecisionStepId: context.originDecisionStepId,
      reviewNodeId: context.reviewNodeId,
      resolutionTransitionId,
      expectedRunVersion: run.version,
      preconditions: preconditionsFor(reason, action),
      requiresReason: requiresReason(reason, action),
      requiresConfirmation: [
        'approve',
        'continue-round',
        'retry-with-duplicate-risk',
        'end-workflow'
      ].includes(action),
      requiredPermission:
        action === 'approve' || action === 'continue-round'
          ? 'workflow-approve'
          : 'workflow-operate',
      expiresAt
    }
  })
}

function configuredActions(
  run: WorkflowRunRecord,
  reason: WorkflowWaitingReason
): WorkflowResolutionAction[] {
  const requestHuman = run.templateSnapshot.transitions.find(
    (transition) =>
      transition.from === run.resolutionContext?.originDecisionNodeId &&
      transition.when === 'decision:request-human'
  )
  const humanGate = run.templateSnapshot.nodes.find(
    (node) => node.id === requestHuman?.to && node.type === 'human-gate'
  )
  if (humanGate?.type !== 'human-gate' || !humanGate.waitingReasons.includes(reason)) {
    return ACTIONS_BY_REASON[reason]
  }
  return ACTIONS_BY_REASON[reason].filter((action) => humanGate.allowedActions.includes(action))
}

function transitionIdForAction(run: WorkflowRunRecord, action: WorkflowResolutionAction): string {
  if (action === 'approve') {
    return run.resolutionContext!.approveTransitionId
  }
  if (action === 'revise' || action === 'continue-round') {
    return run.resolutionContext!.reviseTransitionId
  }
  if (action === 'end-workflow') {
    return 'run-resolution:end-workflow'
  }
  return `run-resolution:${action}`
}

function requiresReason(reason: WorkflowWaitingReason, action: WorkflowResolutionAction): boolean {
  if (action === 'end-workflow' || action === 'revise') {
    return true
  }
  if (action !== 'approve') {
    return false
  }
  return [
    'review-request-human',
    'review-revision-required',
    'review-conflict',
    'decision-invalid'
  ].includes(reason)
}

function preconditionsFor(
  reason: WorkflowWaitingReason,
  action: WorkflowResolutionAction
): string[] {
  const conditions = ['run-version-current', `waiting-reason:${reason}`]
  if (['approve', 'revise', 'continue-round'].includes(action)) {
    conditions.push('review-aggregate-current', 'artifact-revision-frozen')
  }
  if (action === 'continue-round') {
    conditions.push('extend-current-review-node-by-one')
  }
  if (action === 'reassign-agent') {
    conditions.push('new-assignment-identity-valid')
  }
  if (action === 'retry-with-duplicate-risk') {
    conditions.push('duplicate-risk-confirmed')
  }
  return conditions
}
