import { describe, expect, it } from 'vitest'
import type { WorkflowRunRecord } from './workflow-definition-types'
import { BUILTIN_WORKFLOW_TEMPLATES } from './workflow-fixtures'
import {
  workflowReviewExtensionForBudget,
  workflowReviewRoundLimit,
  workflowReviewRoundsRemaining
} from './workflow-review-round-budget'

function runWithExtension(
  extension = 0
): Pick<WorkflowRunRecord, 'templateSnapshot' | 'reviewRoundExtensionsByNodeId'> {
  const template = BUILTIN_WORKFLOW_TEMPLATES.find(
    (candidate) => candidate.id === 'builtin.code-review.v1'
  )!
  return {
    templateSnapshot: structuredClone(template.definition),
    reviewRoundExtensionsByNodeId: { 'code-review': extension }
  }
}

describe('workflow review round budget', () => {
  it('starts an exact new budget even when it is smaller than the old remainder', () => {
    const run = runWithExtension()
    const extension = workflowReviewExtensionForBudget(run, 'code-review', 1, 1)
    const intervened = runWithExtension(extension)

    expect(extension).toBe(-1)
    expect(workflowReviewRoundLimit(intervened, 'code-review')).toBe(2)
    expect(workflowReviewRoundsRemaining(intervened, 'code-review', 1)).toBe(1)
    expect(workflowReviewRoundsRemaining(intervened, 'code-review', 2)).toBe(0)
  })

  it('replaces an earlier extension instead of accumulating it', () => {
    const run = runWithExtension(4)

    expect(workflowReviewExtensionForBudget(run, 'code-review', 5, 2)).toBe(4)
  })
})
