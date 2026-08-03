import type {
  WorkflowResolutionOffer,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import {
  isWorkflowV2HumanRouteTransition,
  workflowV2HumanRouteId
} from './workflow-resolution-offers-v2'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { resolveWorkflowV2HumanAction } from './workflow-v2-run-controller'

export function tryResolveWorkflowV2HumanOffer(params: {
  store: WorkflowRuntimePersistence
  run: WorkflowRunRecord
  offer: WorkflowResolutionOffer
  reason?: string
}): boolean {
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
  params: { reviewRoundBudget?: number }
): boolean {
  if (!isWorkflowV2HumanRouteTransition(offer.resolutionTransitionId)) {
    return false
  }
  if (params.reviewRoundBudget !== undefined) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Review round budget is not valid for V2 human routes.'
    )
  }
  return true
}
