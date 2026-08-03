import { describe, expect, it } from 'vitest'
import { workflowDefinitionV2Schema } from './workflow-definition-v2-schema'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'

describe('WorkflowDefinitionV2', () => {
  it('validates all three representative built-in V2 templates', () => {
    expect(BUILTIN_WORKFLOW_V2_TEMPLATES).toHaveLength(3)
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
