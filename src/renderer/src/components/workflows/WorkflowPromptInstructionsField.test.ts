import { describe, expect, it } from 'vitest'
import type { WorkflowNodeDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { defaultWorkflowPromptInstructions } from '../../../../shared/workflow-prompt-instructions'
import { promptInstructionsForTemplateKeyChange } from './WorkflowPromptInstructionsField'

const reviewNode: WorkflowNodeDefinitionV1 = {
  id: 'review',
  name: 'Review',
  type: 'review',
  roleSlotIds: ['reviewers'],
  promptTemplateKey: 'builtin.spec.review.v1',
  promptInstructions: defaultWorkflowPromptInstructions('builtin.spec.review.v1'),
  inputBindings: ['root-goal', 'upstream-completion', 'artifact-revision'],
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000, onExhausted: 'wait-human' },
  reviewPolicy: {
    minReviewers: 1,
    completion: 'all-required',
    onReviewerFailure: 'wait-human',
    timeoutMs: 3_600_000,
    maxReviewRounds: 3
  },
  outputSchema: 'workflow.review-result/v1'
}

describe('Workflow Prompt instructions editing', () => {
  it('moves an unchanged built-in template to the matching task default', () => {
    const changed = promptInstructionsForTemplateKeyChange(reviewNode, 'builtin.code.review.v1')

    expect(changed.promptInstructions).toBe(
      defaultWorkflowPromptInstructions('builtin.code.review.v1')
    )
    expect(changed.inputBindings).toEqual(['root-goal', 'upstream-completion', 'artifact-revision'])
  })

  it('preserves custom instructions when the task type changes', () => {
    const changed = promptInstructionsForTemplateKeyChange(
      { ...reviewNode, promptInstructions: '自定义：{{rootGoal}}' },
      'builtin.code.review.v1'
    )

    expect(changed.promptInstructions).toBe('自定义：{{rootGoal}}')
  })
})
