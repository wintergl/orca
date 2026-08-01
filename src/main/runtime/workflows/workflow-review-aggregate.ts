import type { WorkflowReviewResultV1 } from '../../../shared/workflow-result-schema'
import type {
  WorkflowReviewAggregate,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'

export type CompletedReviewer = {
  step: WorkflowStepRunRecord
  result: WorkflowReviewResultV1
}

export function buildWorkflowReviewAggregate(params: {
  id: string
  run: WorkflowRunRecord
  reviewNodeId: string
  round: number
  artifactRevisionId: string
  reviewers: CompletedReviewer[]
  createdAt: string
}): WorkflowReviewAggregate {
  const reviewers = stableReviewers(params.run, params.reviewers)
  const verdicts = new Set(reviewers.map(({ result }) => result.verdict))
  const blockers = reviewers.filter(({ result }) =>
    result.issues.some((issue) => issue.severity === 'blocker')
  )
  const outcome = aggregateOutcome(reviewers, blockers.length > 0)
  const conflicts = reviewConflicts(reviewers, verdicts, blockers)
  return {
    schema: 'workflow.review-aggregate/v1',
    id: params.id,
    reviewNodeId: params.reviewNodeId,
    round: params.round,
    artifactRevisionId: params.artifactRevisionId,
    reviewerStepRunIds: reviewers.map(({ step }) => step.id),
    outcome,
    conflicts,
    waitingReason: waitingReason(outcome, conflicts),
    content: reviewers
      .map(
        ({ step, result }) =>
          `【${step.assignment?.agentLifecycleId ?? step.id}】\n${result.conclusionMarkdown}`
      )
      .join('\n\n'),
    createdAt: params.createdAt
  }
}

function stableReviewers(
  run: WorkflowRunRecord,
  reviewers: CompletedReviewer[]
): CompletedReviewer[] {
  const slotOrder = new Map(run.templateSnapshot.roleSlots.map((slot, index) => [slot.id, index]))
  return reviewers.toSorted((left, right) => {
    const leftSlot = slotOrder.get(left.step.assignment?.slotId ?? '') ?? Number.MAX_SAFE_INTEGER
    const rightSlot = slotOrder.get(right.step.assignment?.slotId ?? '') ?? Number.MAX_SAFE_INTEGER
    return leftSlot - rightSlot || left.step.id.localeCompare(right.step.id)
  })
}

function aggregateOutcome(
  reviewers: CompletedReviewer[],
  hasBlocker: boolean
): WorkflowReviewAggregate['outcome'] {
  if (reviewers.some(({ result }) => result.verdict === 'request-human')) {
    return 'request-human'
  }
  if (hasBlocker || reviewers.some(({ result }) => result.verdict === 'revise')) {
    return 'revise'
  }
  return 'approve'
}

function reviewConflicts(
  reviewers: CompletedReviewer[],
  verdicts: Set<WorkflowReviewResultV1['verdict']>,
  blockers: CompletedReviewer[]
): string[] {
  const conflicts: string[] = []
  if (verdicts.size > 1) {
    conflicts.push(
      `Reviewer verdicts differ: ${reviewers
        .map(
          ({ step, result }) => `${step.assignment?.agentLifecycleId ?? step.id}=${result.verdict}`
        )
        .join(', ')}`
    )
  }
  for (const { step, result } of blockers) {
    if (result.verdict === 'approve') {
      conflicts.push(
        `${step.assignment?.agentLifecycleId ?? step.id} reported a blocker with approve`
      )
    }
  }
  return conflicts
}

function waitingReason(
  outcome: WorkflowReviewAggregate['outcome'],
  conflicts: string[]
): WorkflowReviewAggregate['waitingReason'] {
  if (outcome === 'approve') {
    return null
  }
  if (outcome === 'revise') {
    return 'review-revision-required'
  }
  return conflicts.length > 0 ? 'review-conflict' : 'review-request-human'
}
