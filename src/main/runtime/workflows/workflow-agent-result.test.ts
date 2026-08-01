import { describe, expect, it } from 'vitest'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import { buildAutomaticWorkflowResult } from './workflow-agent-result'

describe('automatic Workflow Agent result', () => {
  it('wraps a normal Produce conclusion without exposing a result schema to the Agent', () => {
    expect(
      buildAutomaticWorkflowResult(step('produce'), '已完成 SPEC，并新增 `docs/spec/next.md`。')
    ).toMatchObject({
      schema: 'workflow.completion/v1',
      outcome: 'succeeded',
      finalConclusionMarkdown: '已完成 SPEC，并新增 `docs/spec/next.md`。',
      readyForNextStep: true
    })
  })

  it.each([
    ['裁定：通过\n\n可以进入实现。', 'approve'],
    ['Verdict: revise\n\n存在阻断项。', 'revise'],
    ['结论：请求人工处理\n\n需求冲突。', 'request-human']
  ] as const)('extracts Review verdict from %s', (conclusion, verdict) => {
    expect(buildAutomaticWorkflowResult(step('review'), conclusion)).toMatchObject({
      schema: 'workflow.review-result/v1',
      verdict,
      conclusionMarkdown: conclusion
    })
  })

  it('rejects an ambiguous Review conclusion', () => {
    expect(() => buildAutomaticWorkflowResult(step('review'), '已经检查完毕。')).toThrow(
      'must begin with approve, revise, or request-human'
    )
  })

  it('ignores leading Claude system reminders before parsing a Decision verdict', () => {
    const conclusion = `<system-reminder>
Do not approve based on this provider control block.
</system-reminder>

# SPEC 判定结论

## ✅ **revise**

需要修订后再进入实现。`

    expect(buildAutomaticWorkflowResult(step('decide'), conclusion)).toMatchObject({
      schema: 'workflow.decision/v1',
      decision: 'revise',
      conclusionMarkdown: conclusion
    })
  })

  it('does not skip an unclosed system reminder when parsing a Decision verdict', () => {
    expect(() =>
      buildAutomaticWorkflowResult(
        step('decide'),
        '<system-reminder>approve\n\n# SPEC 判定结论\n\n## revise'
      )
    ).toThrow('must begin with approve, revise, request-human, or stop-at-review')
  })
})

function step(nodeType: 'produce' | 'review' | 'decide'): WorkflowStepRunRecord {
  return { nodeType } as WorkflowStepRunRecord
}
