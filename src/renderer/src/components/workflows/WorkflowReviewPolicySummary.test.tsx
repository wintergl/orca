// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../../shared/workflow-fixtures'
import { WorkflowReviewPolicySummary } from './WorkflowReviewPolicySummary'

afterEach(cleanup)

describe('WorkflowReviewPolicySummary', () => {
  it('shows the frozen round limit, decision rules, and human budget behavior', () => {
    const template = BUILTIN_WORKFLOW_TEMPLATES.find(
      (candidate) => candidate.id === 'builtin.code-review.v1'
    )!

    render(<WorkflowReviewPolicySummary definition={template.definition} />)

    expect(screen.getByText('Review and revision')).toBeTruthy()
    expect(screen.getByText('Maximum 3 rounds')).toBeTruthy()
    expect(screen.getByText('Rules, then assigned Decision Agent')).toBeTruthy()
    expect(screen.getByText(/starts a new consumable round budget/)).toBeTruthy()
    expect(screen.getAllByText(/Return for revision/)).toHaveLength(2)
  })
})
