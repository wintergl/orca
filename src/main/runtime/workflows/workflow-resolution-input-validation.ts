import type { WorkflowResolutionOffer } from '../../../shared/workflow-definition-types'
import { WORKFLOW_REVIEW_ROUND_BUDGET_MAX } from '../../../shared/workflow-review-round-budget'
import { WorkflowError } from './workflow-error'
import { validateWorkflowV2OfferInput } from './workflow-run-control-v2-resolve'

export function validateWorkflowResolutionInput(
  offer: WorkflowResolutionOffer,
  params: {
    reason?: string
    reviewRoundBudget?: number
    routeTraversalBudget?: number
    confirmation: boolean
  }
): void {
  if (offer.requiresReason && !params.reason?.trim()) {
    throw new WorkflowError('workflow_action_forbidden', 'This action requires a reason.')
  }
  if (offer.requiresConfirmation && !params.confirmation) {
    throw new WorkflowError('workflow_action_forbidden', 'This action requires confirmation.')
  }
  if (validateWorkflowV2OfferInput(offer, params)) {
    validateRouteExtension(offer, params.routeTraversalBudget)
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
  if (params.routeTraversalBudget !== undefined) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Route traversal budget is valid only for a V2 route extension.'
    )
  }
}

function validateRouteExtension(
  offer: WorkflowResolutionOffer,
  routeTraversalBudget: number | undefined
): void {
  if (
    offer.action === 'extend-route-budget' &&
    (!Number.isInteger(routeTraversalBudget) ||
      routeTraversalBudget! < 1 ||
      routeTraversalBudget! > 50)
  ) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Route traversal extension must be between 1 and 50.'
    )
  }
}
