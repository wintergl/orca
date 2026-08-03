import type {
  WorkflowResolutionOffer,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import {
  isWorkflowV2HumanRouteTransition,
  WORKFLOW_V2_ROUTE_EXTENSION_PREFIX,
  workflowV2HumanRouteId
} from './workflow-resolution-offers-v2'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { resolveWorkflowV2HumanAction } from './workflow-v2-run-controller'
import {
  addWorkflowV2RouteBudgetExtension,
  incrementWorkflowV2RouteTraversal
} from './workflow-v2-history-store'
import { applyWorkflowV2Advance } from './workflow-v2-advance'
import { requireWorkflowDefinitionV2 } from '../../../shared/workflow-definition-access'

export function tryResolveWorkflowV2HumanOffer(params: {
  store: WorkflowRuntimePersistence
  run: WorkflowRunRecord
  offer: WorkflowResolutionOffer
  reason?: string
  routeTraversalBudget?: number
  actorIdentity: string
}): boolean {
  if (params.offer.resolutionTransitionId.startsWith(WORKFLOW_V2_ROUTE_EXTENSION_PREFIX)) {
    const routeId = params.offer.resolutionTransitionId.slice(
      WORKFLOW_V2_ROUTE_EXTENSION_PREFIX.length
    )
    const amount = params.routeTraversalBudget
    const targetStepId = params.run.resolutionContext?.v2ExhaustedTargetStepId
    if (!amount || !Number.isInteger(amount) || amount < 1 || amount > 50 || !targetStepId) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Route traversal extension must be between 1 and 50.'
      )
    }
    addWorkflowV2RouteBudgetExtension(params.store.db, {
      runId: params.run.id,
      routeId,
      amount,
      actorIdentity: params.actorIdentity
    })
    const definition = requireWorkflowDefinitionV2(
      params.run.templateSnapshot,
      'V2 route budget extension'
    )
    const round = Math.max(1, ...params.run.steps.map((step) => step.round), 1)
    params.store.insertEvent(params.run.id, 'route-budget-extended', null, {
      routeId,
      amount,
      actorIdentity: params.actorIdentity
    })
    incrementWorkflowV2RouteTraversal(params.store.db, params.run.id, routeId)
    applyWorkflowV2Advance(
      params.store,
      params.run,
      definition,
      { kind: 'goto', stepId: targetStepId, routeId },
      round
    )
    return true
  }
  if (!isWorkflowV2HumanRouteTransition(params.offer.resolutionTransitionId)) {
    return false
  }
  if (!params.run.currentNodeId) {
    throw new WorkflowError('workflow_transition_invalid', 'V2 human step is missing.')
  }
  resolveWorkflowV2HumanAction({
    store: params.store,
    db: params.store.db,
    run: params.run,
    stepId: params.run.currentNodeId,
    routeId: workflowV2HumanRouteId(params.offer.resolutionTransitionId),
    humanText: params.reason
  })
  return true
}

export function validateWorkflowV2OfferInput(
  offer: WorkflowResolutionOffer,
  params: { reviewRoundBudget?: number; routeTraversalBudget?: number }
): boolean {
  if (offer.action === 'extend-route-budget') {
    if (params.reviewRoundBudget !== undefined) {
      throw new WorkflowError(
        'workflow_action_forbidden',
        'Review round budget is not valid for V2 route extension.'
      )
    }
    return true
  }
  if (!isWorkflowV2HumanRouteTransition(offer.resolutionTransitionId)) {
    return false
  }
  if (params.reviewRoundBudget !== undefined || params.routeTraversalBudget !== undefined) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Review round budget is not valid for V2 human routes.'
    )
  }
  return true
}
