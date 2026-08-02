import { describe, expect, it } from 'vitest'
import {
  hasWorkflowDecisionProtocolConflict,
  parseWorkflowDecisionToken,
  parseWorkflowReviewVerdict,
  stampWorkflowDecisionProtocolVersionV1,
  WORKFLOW_DECISION_PROTOCOL_VERSION_V1,
  workflowDecisionAllowsAliases,
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

  it('rejects binary verdict even when a later line has approve', () => {
    expect(() => parseWorkflowDecisionToken('# 判定结果\n完成\napprove')).toThrow(/must begin with/)
  })

  it('rejects prose that merely mentions approve', () => {
    expect(() => parseWorkflowDecisionToken('I cannot approve this result')).toThrow(
      /must begin with/
    )
  })

  it('fail-closes an explicit Verdict label with a non-token value', () => {
    expect(() =>
      parseWorkflowDecisionToken('Verdict: I cannot approve this result\napprove')
    ).toThrow(/must begin with/)
    expect(() => parseWorkflowDecisionToken('Decision: still unclear\nrevise')).toThrow(
      /must begin with/
    )
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

  it('allows aliases only for unversioned templates', () => {
    expect(workflowDecisionAllowsAliases(undefined)).toBe(true)
    expect(workflowDecisionAllowsAliases(null)).toBe(true)
    expect(workflowDecisionAllowsAliases(WORKFLOW_DECISION_PROTOCOL_VERSION_V1)).toBe(false)
  })

  it.each([
    '结论第一行只能是完成/不完成，不要写其他内容。',
    "首行仅允许'完成'或'不完成'",
    '第一行输出必须为完成或不完成',
    '只能输出完成或不完成'
  ])('detects V1 protocol conflict for %s', (prompt) => {
    expect(hasWorkflowDecisionProtocolConflict(prompt)).toBe(true)
  })

  it('does not flag ordinary review business prompts as protocol conflicts', () => {
    expect(hasWorkflowDecisionProtocolConflict('请评审产物并列出阻断项。')).toBe(false)
  })

  it('stamps V1 protocol version on save', () => {
    const stamped = stampWorkflowDecisionProtocolVersionV1({ schemaVersion: 1 as const })
    expect(stamped).toEqual({
      schemaVersion: 1,
      decisionProtocolVersion: WORKFLOW_DECISION_PROTOCOL_VERSION_V1
    })
    // Typed as forced V1, not optional.
    const version: typeof WORKFLOW_DECISION_PROTOCOL_VERSION_V1 = stamped.decisionProtocolVersion
    expect(version).toBe(WORKFLOW_DECISION_PROTOCOL_VERSION_V1)
  })
})
