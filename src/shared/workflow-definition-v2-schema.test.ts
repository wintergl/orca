import { describe, expect, it } from 'vitest'
import { workflowDefinitionV2Schema } from './workflow-definition-v2-schema'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'

describe('WorkflowDefinitionV2', () => {
  it('validates the two default V2 review workflows', () => {
    expect(BUILTIN_WORKFLOW_V2_TEMPLATES).toHaveLength(2)
    expect(BUILTIN_WORKFLOW_V2_TEMPLATES.map((template) => template.id)).toEqual([
      'builtin.v2.spec-review',
      'builtin.v2.code-review'
    ])
    for (const template of BUILTIN_WORKFLOW_V2_TEMPLATES) {
      expect(workflowDefinitionV2Schema.parse(template.definition)).toEqual(template.definition)
    }
  })

  it('rejects graphs without an end step', () => {
    const broken = structuredClone(BUILTIN_WORKFLOW_V2_TEMPLATES[0]!.definition)
    broken.steps = broken.steps.filter((step) => step.kind !== 'end')
    expect(workflowDefinitionV2Schema.safeParse(broken).success).toBe(false)
  })
})
