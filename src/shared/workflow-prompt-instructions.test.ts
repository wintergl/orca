import { describe, expect, it } from 'vitest'
import {
  defaultWorkflowPromptInstructions,
  inspectWorkflowPromptInstructions,
  renderWorkflowPromptInstructions,
  requiredWorkflowPromptInputBindings
} from './workflow-prompt-instructions'

describe('workflow prompt instructions', () => {
  it('extracts the input bindings required by a built-in template', () => {
    const template = defaultWorkflowPromptInstructions('builtin.spec.review.v1')

    expect(requiredWorkflowPromptInputBindings(template)).toEqual([
      'root-goal',
      'upstream-completion',
      'artifact-revision'
    ])
  })

  it('detects unknown and unclosed placeholders', () => {
    expect(inspectWorkflowPromptInstructions('{{unknown}} {{rootGoal')).toMatchObject({
      placeholders: [],
      unknown: ['unknown'],
      malformed: true
    })
  })

  it('renders known values and removes an unavailable input paragraph', () => {
    const rendered = renderWorkflowPromptInstructions(
      '目标：{{rootGoal}}\n\n结果：{{artifactRevision}}',
      { rootGoal: '完善工作流' }
    )

    expect(rendered).toBe('目标：完善工作流')
    expect(rendered).not.toContain('{{')
  })

  it('keeps task instructions that share a paragraph with an unavailable input', () => {
    const rendered = renderWorkflowPromptInstructions(
      '目标：{{rootGoal}}\n\n请完成本轮 SPEC。若有评审意见请修订：\n{{reviewAggregate}}',
      { rootGoal: '完善工作流' }
    )

    expect(rendered).toContain('请完成本轮 SPEC。')
    expect(rendered).not.toContain('{{reviewAggregate}}')
  })

  it('resolves a node output by relative round and stable node ID', () => {
    const template = '评审结果：{{ history[-1].nodes["review"].output }}'
    const inspection = inspectWorkflowPromptInstructions(template)

    expect(inspection).toMatchObject({
      unknown: [],
      malformed: false,
      historyReferences: [{ round: -1, nodeId: 'review' }]
    })
    expect(
      renderWorkflowPromptInstructions(
        template,
        {},
        {
          currentRound: 3,
          history: [
            { round: 1, nodeId: 'review', output: '第一轮', sequence: 1 },
            { round: 2, nodeId: 'review', output: '第二轮', sequence: 2 }
          ]
        }
      )
    ).toBe('评审结果：第二轮')
  })

  it('fails instead of silently erasing a missing history reference', () => {
    expect(() =>
      renderWorkflowPromptInstructions(
        '{{ history[1].nodes["missing"].output }}',
        {},
        { currentRound: 2, history: [] }
      )
    ).toThrow('Missing workflow history output')
  })
})
