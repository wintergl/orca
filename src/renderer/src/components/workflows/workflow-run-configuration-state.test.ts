import { describe, expect, it } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { getBuiltinWorkflowTemplate } from '../../../../shared/workflow-fixtures'
import {
  effectiveRunPolicy,
  runPolicyOverrideForSave,
  runPromptOverridesForSave
} from './workflow-run-configuration-state'

describe('workflow run configuration state', () => {
  it('does not turn unchanged template defaults into run overrides', () => {
    const template = getBuiltinWorkflowTemplate('builtin.spec-review.v1')!
    const run = {
      templateSnapshot: template.definition,
      policyOverrides: null
    } as WorkflowRunRecord
    const policy = effectiveRunPolicy(run)
    expect(runPolicyOverrideForSave(run, policy)).toBeNull()
    expect(runPromptOverridesForSave({})).toBeNull()
  })

  it('retains explicit and changed run policy values', () => {
    const template = getBuiltinWorkflowTemplate('builtin.spec-review.v1')!
    const run = {
      templateSnapshot: template.definition,
      policyOverrides: null
    } as WorkflowRunRecord
    const policy = effectiveRunPolicy(run)
    if (policy.policyVersion !== 'v1-review-rounds') {
      throw new Error('expected V1 policy')
    }
    const nodeId = Object.keys(policy.maxReviewRoundsByNodeId)[0]!
    policy.maxReviewRoundsByNodeId[nodeId] = 1
    expect(runPolicyOverrideForSave(run, policy)).toEqual(policy)
    expect(runPromptOverridesForSave({ node: { repeatVisit: 'changed' } })).toEqual({
      node: { repeatVisit: 'changed' }
    })
  })
})
