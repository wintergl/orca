// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { WorkflowRunPromptHistory } from './WorkflowRunPromptHistory'

afterEach(cleanup)

describe('WorkflowRunPromptHistory', () => {
  it('combines lineage prompts with current steps and de-duplicates recorded delivery', () => {
    render(<WorkflowRunPromptHistory run={runRecord()} selectedStepRunId="step-current" />)

    expect(screen.getByText('Prompt history')).toBeTruthy()
    expect(screen.getByText('Inherited parent prompt.')).toBeTruthy()
    expect(screen.getAllByText('Current delivered prompt.')).toHaveLength(1)
    const currentPrompt = screen.getByText('Current delivered prompt.')
    expect(currentPrompt.closest('details')?.open).toBe(true)
    expect(screen.getAllByText(/Recorded history/)).toHaveLength(2)
  })
})

function runRecord(): WorkflowRunRecord {
  return {
    id: 'run-child',
    lineageCycleBase: 2,
    promptOverrides: null,
    v2History: [
      {
        sequence: 1,
        stepId: 'author',
        stepName: 'Author',
        stepKind: 'agent',
        visit: 1,
        cycle: 1,
        attempt: 1,
        promptText: 'Inherited parent prompt.',
        finalText: 'Parent result',
        agentOutputs: [],
        decision: null,
        createdAt: '2026-08-01T00:00:00.000Z'
      },
      {
        sequence: 2,
        stepId: 'author',
        stepName: 'Author',
        stepKind: 'agent',
        visit: 2,
        cycle: 3,
        attempt: 1,
        promptText: 'Current delivered prompt.',
        finalText: 'Current result',
        agentOutputs: [],
        decision: null,
        createdAt: '2026-08-02T00:00:00.000Z'
      }
    ],
    steps: [
      {
        id: 'step-current',
        nodeId: 'author',
        nodeName: 'Author',
        round: 1,
        attempt: 1,
        prompt: 'Current delivered prompt.'
      }
    ]
  } as unknown as WorkflowRunRecord
}
