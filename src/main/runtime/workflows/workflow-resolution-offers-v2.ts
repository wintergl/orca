import { createHash } from 'node:crypto'
import type {
  WorkflowResolutionAction,
  WorkflowResolutionOffer,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import { workflowV2StepById } from '../../../shared/workflow-v2-graph'

const OFFER_TTL_MS = 24 * 60 * 60 * 1_000
export const WORKFLOW_V2_HUMAN_ROUTE_PREFIX = 'v2-human:' as const
export const WORKFLOW_V2_ROUTE_EXTENSION_PREFIX = 'v2-route-extension:' as const

export function isWorkflowV2HumanRouteTransition(transitionId: string): boolean {
  return transitionId.startsWith(WORKFLOW_V2_HUMAN_ROUTE_PREFIX)
}

export function workflowV2HumanRouteId(transitionId: string): string {
  return transitionId.slice(WORKFLOW_V2_HUMAN_ROUTE_PREFIX.length)
}

export function buildWorkflowV2ResolutionOffers(
  run: WorkflowRunRecord
): WorkflowResolutionOffer[] | null {
  if (!isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    return null
  }
  if (run.status !== 'waiting-human') {
    return null
  }
  // Why: only specialize known V2 reasons; null lets generic delivery/lifecycle offers apply.
  if (run.waitingReason === 'decision-invalid') {
    return buildV2HumanRouteOffers(run)
  }
  if (run.waitingReason === 'completion-incomplete') {
    return buildV2RecoveryOffers(run)
  }
  return null
}

function buildV2HumanRouteOffers(run: WorkflowRunRecord): WorkflowResolutionOffer[] {
  const stepId = run.currentNodeId
  if (!stepId) {
    return []
  }
  const human = workflowV2StepById(run.templateSnapshot as never, stepId)
  if (human?.kind !== 'human') {
    return []
  }
  const expiresAt = offerExpiry(run)
  if (!expiresAt) {
    return []
  }
  const routeOffers = human.routes.map((route) => {
    const targetsEnd =
      workflowV2StepById(run.templateSnapshot as never, route.targetStepId)?.kind === 'end'
    const action: WorkflowResolutionAction = targetsEnd ? 'approve' : 'revise'
    const resolutionTransitionId = `${WORKFLOW_V2_HUMAN_ROUTE_PREFIX}${route.id}`
    return makeOffer(run, {
      waitingReason: 'decision-invalid',
      action,
      originDecisionStepId: run.resolutionContext?.originDecisionStepId ?? '',
      reviewNodeId: stepId,
      resolutionTransitionId,
      expiresAt,
      preconditions: ['run-version-current', 'waiting-reason:decision-invalid', 'v2-human-route'],
      requiresReason: route.requiresText,
      requiresConfirmation: route.requiresConfirmation,
      requiredPermission: targetsEnd ? 'workflow-approve' : 'workflow-operate',
      displayLabel: route.label
    })
  })
  const exhaustedRouteId = run.resolutionContext?.v2ExhaustedRouteId
  if (!exhaustedRouteId) {
    return routeOffers
  }
  return [
    makeOffer(run, {
      waitingReason: 'decision-invalid',
      action: 'extend-route-budget',
      originDecisionStepId: run.resolutionContext?.originDecisionStepId ?? '',
      reviewNodeId: stepId,
      resolutionTransitionId: `${WORKFLOW_V2_ROUTE_EXTENSION_PREFIX}${exhaustedRouteId}`,
      expiresAt,
      preconditions: ['run-version-current', 'v2-route-exhausted', exhaustedRouteId],
      requiresReason: true,
      requiresConfirmation: true,
      requiredPermission: 'workflow-operate',
      displayLabel: 'Extend route budget'
    }),
    ...routeOffers
  ]
}

function buildV2RecoveryOffers(run: WorkflowRunRecord): WorkflowResolutionOffer[] {
  if (!run.resolutionContext) {
    return []
  }
  const expiresAt = offerExpiry(run)
  if (!expiresAt) {
    return []
  }
  const origin = run.resolutionContext.originDecisionStepId
  return [
    makeOffer(run, {
      waitingReason: 'completion-incomplete',
      action: 'retry-step',
      originDecisionStepId: origin,
      reviewNodeId: run.resolutionContext.reviewNodeId,
      resolutionTransitionId: 'v2-recovery:retry-step',
      expiresAt,
      preconditions: ['run-version-current', 'waiting-reason:completion-incomplete'],
      requiresReason: false,
      requiresConfirmation: true,
      requiredPermission: 'workflow-operate',
      displayLabel: 'Retry step'
    }),
    makeOffer(run, {
      waitingReason: 'completion-incomplete',
      action: 'reassign-agent',
      originDecisionStepId: origin,
      reviewNodeId: run.resolutionContext.reviewNodeId,
      resolutionTransitionId: 'v2-recovery:reassign-agent',
      expiresAt,
      preconditions: [
        'run-version-current',
        'waiting-reason:completion-incomplete',
        'new-assignment-identity-valid'
      ],
      requiresReason: true,
      requiresConfirmation: true,
      requiredPermission: 'workflow-operate',
      displayLabel: 'Reassign Agent'
    }),
    makeOffer(run, {
      waitingReason: 'completion-incomplete',
      action: 'end-workflow',
      originDecisionStepId: origin,
      reviewNodeId: run.resolutionContext.reviewNodeId,
      resolutionTransitionId: 'v2-recovery:end-workflow',
      expiresAt,
      preconditions: ['run-version-current', 'waiting-reason:completion-incomplete'],
      requiresReason: true,
      requiresConfirmation: true,
      requiredPermission: 'workflow-operate',
      displayLabel: 'End Workflow'
    })
  ]
}

function offerExpiry(run: WorkflowRunRecord): string | null {
  const expiresAtMs = Date.parse(run.updatedAt) + OFFER_TTL_MS
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null
  }
  return new Date(expiresAtMs).toISOString()
}

function makeOffer(
  run: WorkflowRunRecord,
  fields: {
    waitingReason: WorkflowResolutionOffer['waitingReason']
    action: WorkflowResolutionAction
    originDecisionStepId: string
    reviewNodeId: string
    resolutionTransitionId: string
    expiresAt: string
    preconditions: string[]
    requiresReason: boolean
    requiresConfirmation: boolean
    requiredPermission: WorkflowResolutionOffer['requiredPermission']
    displayLabel: string
  }
): WorkflowResolutionOffer {
  const seed = JSON.stringify({
    runId: run.id,
    version: run.version,
    reason: fields.waitingReason,
    action: fields.action,
    resolutionTransitionId: fields.resolutionTransitionId,
    expiresAt: fields.expiresAt
  })
  return {
    id: `workflow_offer_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`,
    runId: run.id,
    waitingReason: fields.waitingReason,
    action: fields.action,
    originDecisionStepId: fields.originDecisionStepId,
    reviewNodeId: fields.reviewNodeId,
    resolutionTransitionId: fields.resolutionTransitionId,
    expectedRunVersion: run.version,
    preconditions: fields.preconditions,
    requiresReason: fields.requiresReason,
    requiresConfirmation: fields.requiresConfirmation,
    requiredPermission: fields.requiredPermission,
    expiresAt: fields.expiresAt,
    displayLabel: fields.displayLabel
  }
}
