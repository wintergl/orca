import type { WorkflowRunRecord } from './workflow-definition-types'
import type { WorkflowRunPolicyOverrides } from './workflow-run-lineage'
import { requireWorkflowDefinitionV1 } from './workflow-definition-access'

export const WORKFLOW_REVIEW_ROUND_BUDGET_MAX = 20

type WorkflowReviewRoundState = Pick<
  WorkflowRunRecord,
  'templateSnapshot' | 'reviewRoundExtensionsByNodeId'
>

function maxReviewRoundsOverride(
  policyOverrides:
    | WorkflowRunPolicyOverrides
    | { maxReviewRoundsByNodeId?: Record<string, number> }
    | null
    | undefined,
  reviewNodeId: string
): number | undefined {
  if (!policyOverrides || typeof policyOverrides !== 'object') {
    return undefined
  }
  if (
    'policyVersion' in policyOverrides &&
    policyOverrides.policyVersion === 'v2-route-traversals'
  ) {
    return undefined
  }
  const map =
    'maxReviewRoundsByNodeId' in policyOverrides
      ? policyOverrides.maxReviewRoundsByNodeId
      : undefined
  return map?.[reviewNodeId]
}

export function workflowReviewRoundLimit(
  run: WorkflowReviewRoundState & {
    policyOverrides?:
      | WorkflowRunPolicyOverrides
      | { maxReviewRoundsByNodeId?: Record<string, number> }
      | null
  },
  reviewNodeId: string
): number | null {
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 review budget')
  const review = definition.nodes.find((node) => node.id === reviewNodeId && node.type === 'review')
  if (review?.type !== 'review') {
    return null
  }
  const initial =
    maxReviewRoundsOverride(run.policyOverrides, reviewNodeId) ??
    review.reviewPolicy.maxReviewRounds
  return initial + (run.reviewRoundExtensionsByNodeId[reviewNodeId] ?? 0)
}

export function workflowReviewRoundsRemaining(
  run: WorkflowReviewRoundState,
  reviewNodeId: string,
  completedRound: number
): number | null {
  const limit = workflowReviewRoundLimit(run, reviewNodeId)
  return limit === null ? null : Math.max(0, limit - completedRound)
}

export function workflowReviewExtensionForBudget(
  run: WorkflowReviewRoundState & {
    policyOverrides?:
      | WorkflowRunPolicyOverrides
      | { maxReviewRoundsByNodeId?: Record<string, number> }
      | null
  },
  reviewNodeId: string,
  completedRound: number,
  budget: number
): number {
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 review extension')
  const review = definition.nodes.find((node) => node.id === reviewNodeId && node.type === 'review')
  if (review?.type !== 'review') {
    throw new Error(`Review node ${reviewNodeId} is unavailable.`)
  }
  const initial =
    maxReviewRoundsOverride(run.policyOverrides, reviewNodeId) ??
    review.reviewPolicy.maxReviewRounds
  return completedRound + budget - initial
}
