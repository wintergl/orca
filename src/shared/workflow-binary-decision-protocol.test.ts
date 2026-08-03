import { describe, expect, it } from 'vitest'
import {
  parseWorkflowBinaryDecision,
  workflowBinaryProtocolInstruction
} from './workflow-binary-decision-protocol'

describe('workflow binary decision protocol v2', () => {
  it('parses 完成/不完成 on the first non-empty line', () => {
    expect(parseWorkflowBinaryDecision('完成\n可以发布')).toBe(true)
    expect(parseWorkflowBinaryDecision('不完成\n继续改')).toBe(false)
  })

  it('rejects V1 tokens and prose', () => {
    expect(() => parseWorkflowBinaryDecision('approve\n完成')).toThrow(/完成/)
    expect(() => parseWorkflowBinaryDecision('I cannot decide')).toThrow(/完成/)
  })

  it('builds the frozen instruction', () => {
    expect(workflowBinaryProtocolInstruction()).toContain('完成')
    expect(workflowBinaryProtocolInstruction()).toContain('不完成')
  })
})
