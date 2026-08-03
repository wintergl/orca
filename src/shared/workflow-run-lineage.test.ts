import { describe, expect, it } from 'vitest'
import {
  assertRerunRequirements,
  parseWorkflowRunPolicyOverrides,
  parseWorkflowRunPromptOverrides
} from './workflow-run-lineage'

describe('workflow run lineage helpers', () => {
  it('requires exactly one of reason or noAdditionalRequirements', () => {
    expect(() =>
      assertRerunRequirements({ rerunReason: null, noAdditionalRequirements: false })
    ).toThrow(/rerun reason/)
    expect(() =>
      assertRerunRequirements({ rerunReason: 'fix', noAdditionalRequirements: true })
    ).toThrow(/rerun reason/)
    expect(() =>
      assertRerunRequirements({ rerunReason: 'fix again', noAdditionalRequirements: false })
    ).not.toThrow()
    expect(() =>
      assertRerunRequirements({ rerunReason: '', noAdditionalRequirements: true })
    ).not.toThrow()
  })

  it('parses frozen policy and prompt overrides', () => {
    expect(
      parseWorkflowRunPolicyOverrides({
        policyVersion: 'v1-review-rounds',
        maxReviewRoundsByNodeId: { 'spec-review': 4, bad: 0 }
      })
    ).toEqual({
      policyVersion: 'v1-review-rounds',
      maxReviewRoundsByNodeId: { 'spec-review': 4 }
    })
    expect(
      parseWorkflowRunPolicyOverrides({
        policyVersion: 'v2-route-traversals',
        maxTraversalsByRouteId: { 'decision:judge:false': 3, bad: -1 }
      })
    ).toEqual({
      policyVersion: 'v2-route-traversals',
      maxTraversalsByRouteId: { 'decision:judge:false': 3 }
    })
    expect(
      parseWorkflowRunPromptOverrides({
        'spec-produce': { firstVisit: 'first', repeatVisit: 'again' },
        skip: null
      })
    ).toEqual({
      'spec-produce': { firstVisit: 'first', repeatVisit: 'again' }
    })
  })
})
