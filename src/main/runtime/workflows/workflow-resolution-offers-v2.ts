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
  if (run.status !== 'waiting-human' || run.waitingReason !== 'decision-invalid') {
    return null
  }
  const stepId = run.currentNodeId
  if (!stepId) {
    return []
  }
  const human = workflowV2StepById(run.templateSnapshot as never, stepId)
  if (human?.kind !== 'human') {
    return []
  }
  const expiresAtMs = Date.parse(run.updatedAt) + OFFER_TTL_MS
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return []
  }
  const expiresAt = new Date(expiresAtMs).toISOString()
  return human.routes.map((route) => {
    const targetsEnd =
      workflowV2StepById(run.templateSnapshot as never, route.targetStepId)?.kind === 'end'
    const action: WorkflowResolutionAction = targetsEnd ? 'approve' : 'revise'
    const resolutionTransitionId = `${WORKFLOW_V2_HUMAN_ROUTE_PREFIX}${route.id}`
    const seed = JSON.stringify({
      runId: run.id,
      version: run.version,
      reason: run.waitingReason,
      action,
      resolutionTransitionId,
      expiresAt
    })
    return {
      id: `workflow_offer_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`,
      runId: run.id,
      waitingReason: 'decision-invalid',
      action,
      originDecisionStepId: run.resolutionContext?.originDecisionStepId ?? '',
      reviewNodeId: stepId,
      resolutionTransitionId,
      expectedRunVersion: run.version,
      preconditions: ['run-version-current', 'waiting-reason:decision-invalid', 'v2-human-route'],
      requiresReason: route.requiresText,
      requiresConfirmation: route.requiresConfirmation,
      requiredPermission: targetsEnd ? 'workflow-approve' : 'workflow-operate',
      expiresAt,
      displayLabel: route.label
    }
  })
}
