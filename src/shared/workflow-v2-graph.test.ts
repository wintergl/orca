import { describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'
import {
  resolveWorkflowV2AgentNext,
  resolveWorkflowV2Decision,
  resolveWorkflowV2Human
} from './workflow-v2-graph'

describe('workflow v2 graph', () => {
  const single = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!.definition
  const loop = BUILTIN_WORKFLOW_V2_TEMPLATES[1]!.definition
  const multi = BUILTIN_WORKFLOW_V2_TEMPLATES[2]!.definition

  it('runs single agent → end', () => {
    expect(resolveWorkflowV2AgentNext(single, 'produce')).toEqual({
      kind: 'end',
      outcome: 'succeeded'
    })
  })

  it('loops decision false until traversal budget exhausts to human', () => {
    expect(resolveWorkflowV2Decision(loop, 'judge', '完成\nok', {})).toEqual({
      kind: 'end',
      outcome: 'succeeded'
    })
    expect(
      resolveWorkflowV2Decision(loop, 'judge', '不完成\nagain', {
        'decision:judge:false': 0
      })
    ).toEqual({ kind: 'goto', stepId: 'produce', routeId: 'decision:judge:false' })
    expect(
      resolveWorkflowV2Decision(loop, 'judge', '不完成\nagain', {
        'decision:judge:false': 2
      })
    ).toEqual({ kind: 'wait-human', stepId: 'human' })
  })

  it('routes invalid binary decisions to human', () => {
    expect(resolveWorkflowV2Decision(loop, 'judge', 'approve\nnope', {})).toEqual({
      kind: 'wait-human',
      stepId: 'human'
    })
  })

  it('supports multi-agent chain and human accept', () => {
    expect(resolveWorkflowV2AgentNext(multi, 'research')).toEqual({
      kind: 'goto',
      stepId: 'write',
      routeId: 'agent:research:next'
    })
    expect(resolveWorkflowV2Human(multi, 'human', 'accept')).toEqual({
      kind: 'end',
      outcome: 'succeeded'
    })
  })
})
