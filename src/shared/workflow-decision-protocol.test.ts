import { describe, expect, it } from 'vitest'
import {
  parseWorkflowDecisionToken,
  parseWorkflowReviewVerdict,
  workflowDecisionProtocolInstruction
} from './workflow-decision-protocol'

describe('workflow decision protocol v1', () => {
  it('parses canonical English decision tokens', () => {
    expect(parseWorkflowDecisionToken('approve\n\nok')).toBe('approve')
    expect(parseWorkflowDecisionToken('revise\n\nfix')).toBe('revise')
    expect(parseWorkflowDecisionToken('request-human\n\nhelp')).toBe('request-human')
    expect(parseWorkflowDecisionToken('stop-at-review\n\nhold')).toBe('stop-at-review')
  })

  it('accepts legacy Chinese aliases when enabled', () => {
    expect(parseWorkflowDecisionToken('裁定：通过\n\n可以进入', { allowAliases: true })).toBe(
      'approve'
    )
    expect(parseWorkflowReviewVerdict('结论：需要修改\n\n问题', { allowAliases: true })).toBe(
      'revise'
    )
  })

  it('rejects V2 binary tokens for V1', () => {
    expect(() => parseWorkflowDecisionToken('完成\n\n可以发布')).toThrow(/must begin with/)
    expect(() => parseWorkflowDecisionToken('不完成\n\n继续改')).toThrow(/must begin with/)
  })

  it('accepts English verdict when body mentions 完成', () => {
    expect(parseWorkflowDecisionToken('approve\n\n已完成全部检查')).toBe('approve')
    expect(parseWorkflowDecisionToken('revise\n\n仍不完成验收')).toBe('revise')
  })

  it('rejects aliases when allowAliases is false', () => {
    expect(() =>
      parseWorkflowDecisionToken('裁定：通过\n\n可以进入', { allowAliases: false })
    ).toThrow(/must begin with/)
  })

  it('builds protocol instructions that require English tokens', () => {
    expect(workflowDecisionProtocolInstruction('decision')).toContain('approve')
    expect(workflowDecisionProtocolInstruction('decision')).toContain('不要使用')
    expect(workflowDecisionProtocolInstruction('review')).toContain('request-human')
  })
})
