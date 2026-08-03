import { describe, expect, it } from 'vitest'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import { parseWorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-schema'
import {
  addWorkflowV2Step,
  removeWorkflowV2Step,
  setWorkflowV2EntryStep,
  updateWorkflowV2Step
} from './workflow-definition-editing-v2'

function blank(): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    decisionProtocolVersion: 'v2-binary-zh',
    entryStepId: 'agent-1',
    roleSlots: [
      {
        id: 'agent',
        label: 'Agent',
        required: true,
        minAgents: 1,
        maxAgents: 1,
        execution: 'single',
        allowedAgentStates: ['idle']
      }
    ],
    steps: [
      {
        id: 'agent-1',
        name: 'Agent step',
        kind: 'agent',
        roleSlotIds: ['agent'],
        execution: 'single',
        prompt: {
          variants: [{ when: 'always', template: 'goal {{goal}} / {{criteria}}' }],
          completionCriteria: 'Done.'
        },
        retryPolicy: { maxAttempts: 2, backoffMs: 0, onExhausted: 'fail-run' },
        next: { targetStepId: 'end' }
      },
      { id: 'end', name: 'Complete', kind: 'end', outcome: 'succeeded' }
    ]
  }
}

describe('workflow definition editing v2', () => {
  it('starts from a blank agent → end graph that validates', () => {
    expect(() => parseWorkflowDefinitionV2(blank())).not.toThrow()
  })

  it('adds decision/human steps and keeps a valid free-form graph', () => {
    let definition = blank()
    const decision = addWorkflowV2Step(definition, 'decision')
    definition = decision.definition
    const human = addWorkflowV2Step(definition, 'human')
    definition = human.definition
    definition = updateWorkflowV2Step(definition, 'agent-1', (step) =>
      step.kind === 'agent' ? { ...step, next: { targetStepId: decision.stepId } } : step
    )
    definition = updateWorkflowV2Step(definition, decision.stepId, (step) =>
      step.kind === 'decision'
        ? {
            ...step,
            routes: {
              whenTrue: { targetStepId: 'end' },
              whenFalse: {
                targetStepId: human.stepId,
                maxTraversals: 2,
                onExhaustedStepId: human.stepId
              },
              whenInvalid: { targetStepId: human.stepId }
            }
          }
        : step
    )
    expect(() => parseWorkflowDefinitionV2(definition)).not.toThrow()
    expect(definition.steps.some((step) => step.kind === 'decision')).toBe(true)
    expect(definition.steps.some((step) => step.kind === 'human')).toBe(true)
  })

  it('retargets routes when a step is removed', () => {
    let definition = blank()
    const added = addWorkflowV2Step(definition, 'agent')
    definition = updateWorkflowV2Step(added.definition, 'agent-1', (step) =>
      step.kind === 'agent' ? { ...step, next: { targetStepId: added.stepId } } : step
    )
    definition = removeWorkflowV2Step(definition, added.stepId)
    const entry = definition.steps.find((step) => step.id === 'agent-1')
    expect(entry?.kind === 'agent' && entry.next.targetStepId).toBe('agent-1')
  })

  it('can switch entry to another agent/decision step', () => {
    const added = addWorkflowV2Step(blank(), 'agent')
    const definition = setWorkflowV2EntryStep(added.definition, added.stepId)
    expect(definition.entryStepId).toBe(added.stepId)
  })
})
