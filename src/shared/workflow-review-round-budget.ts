import type { WorkflowRunRecord } from './workflow-definition-types'

export const WORKFLOW_REVIEW_ROUND_BUDGET_MAX = 20

type WorkflowReviewRoundState = Pick<
  WorkflowRunRecord,
  'templateSnapshot' | 'reviewRoundExtensionsByNodeId'
>

export function workflowReviewRoundLimit(
  run: WorkflowReviewRoundState & {
    policyOverrides?: { maxReviewRoundsByNodeId?: Record<string, number> } | null
  },
  reviewNodeId: string
): number | null {
  const review = run.templateSnapshot.nodes.find(
    (node) => node.id === reviewNodeId && node.type === 'review'
  )
  if (review?.type !== 'review') {
    return null
  }
  const initial =
    run.policyOverrides?.maxReviewRoundsByNodeId?.[reviewNodeId] ??
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
    policyOverrides?: { maxReviewRoundsByNodeId?: Record<string, number> } | null
  },
  reviewNodeId: string,
  completedRound: number,
  budget: number
): number {
  const review = run.templateSnapshot.nodes.find(
    (node) => node.id === reviewNodeId && node.type === 'review'
  )
  if (review?.type !== 'review') {
    throw new Error(`Review node ${reviewNodeId} is unavailable.`)
  }
  const initial =
    run.policyOverrides?.maxReviewRoundsByNodeId?.[reviewNodeId] ??
    review.reviewPolicy.maxReviewRounds
  return completedRound + budget - initial
}
