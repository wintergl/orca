import { describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'
import { validateWorkflowV2Graph } from './workflow-v2-graph-validation'

describe('workflow V2 graph validation', () => {
  it('accepts all representative built-in graphs', () => {
    for (const template of BUILTIN_WORKFLOW_V2_TEMPLATES) {
      expect(validateWorkflowV2Graph(template.definition)).toEqual([])
    }
  })

  it('rejects an unbounded cycle and accepts a run-level bound with exhausted target', () => {
    const definition = structuredClone(BUILTIN_WORKFLOW_V2_TEMPLATES[1]!.definition)
    const decision = definition.steps.find((step) => step.id === 'judge')
    if (decision?.kind !== 'decision') {
      throw new Error('fixture decision step missing')
    }
    delete decision.routes.whenFalse.maxTraversals
    expect(validateWorkflowV2Graph(definition)).toContain(
      'Reachable route graph contains an unbounded loop'
    )
    expect(validateWorkflowV2Graph(definition, { 'decision:judge:false': 2 })).not.toContain(
      'Reachable route graph contains an unbounded loop'
    )
  })
})
