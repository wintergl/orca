import { describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'
import { validateWorkflowPromptBoundaries } from './workflow-prompt-boundary-validation'

describe('workflow prompt boundary validation', () => {
  it('accepts the runnable V2 fixtures', () => {
    for (const template of BUILTIN_WORKFLOW_V2_TEMPLATES) {
      expect(validateWorkflowPromptBoundaries(template.definition)).toEqual([])
    }
  })

  it('rejects negative history in first visit and missing repeat history', () => {
    const definition = structuredClone(BUILTIN_WORKFLOW_V2_TEMPLATES[1]!.definition)
    const produce = definition.steps.find((step) => step.id === 'produce')
    if (produce?.kind !== 'agent') {
      throw new Error('fixture produce step missing')
    }
    produce.prompt.variants = [
      {
        when: 'first-visit',
        template: 'bad {{ history[-1].nodes["produce"].output }} {{criteria}}'
      },
      { when: 'repeat-visit', template: 'repeat without history {{criteria}}' }
    ]
    expect(validateWorkflowPromptBoundaries(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'produce',
          message: expect.stringContaining('negative')
        }),
        expect.objectContaining({ nodeId: 'produce', message: expect.stringContaining('history') })
      ])
    )
    produce.prompt.repeatVisitHistoryMode = 'not-required'
    expect(validateWorkflowPromptBoundaries(definition)).toEqual([
      expect.objectContaining({ nodeId: 'produce', message: expect.stringContaining('negative') })
    ])
  })
})
