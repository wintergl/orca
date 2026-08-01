import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../shared/native-chat-types'
import { extractWorkflowAgentFinalResponse } from './workflow-agent-final-response'

describe('Workflow Agent final response extraction', () => {
  it('returns only the Assistant response after the dispatched prompt', () => {
    const messages = [
      message('user', '旧任务'),
      message('assistant', '旧结论'),
      message('user', '完成下一阶段优化'),
      message('assistant', '新结论')
    ]

    expect(extractWorkflowAgentFinalResponse(messages, '完成下一阶段优化')).toBe('新结论')
  })

  it('does not reuse an earlier Assistant response before prompt delivery', () => {
    expect(extractWorkflowAgentFinalResponse([message('assistant', '旧结论')], '新任务')).toBeNull()
  })
})

function message(role: 'user' | 'assistant', text: string): NativeChatMessage {
  return {
    id: `${role}-${text}`,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: 1,
    source: 'transcript'
  }
}
