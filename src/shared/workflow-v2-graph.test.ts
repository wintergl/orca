import { describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from './workflow-v2-fixtures'
import {
  resolveWorkflowV2AgentNext,
  resolveWorkflowV2Decision,
  resolveWorkflowV2Human
} from './workflow-v2-graph'

describe('workflow v2 graph', () => {
  const spec = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!.definition
  const code = BUILTIN_WORKFLOW_V2_TEMPLATES[1]!.definition

  it('chains writing and review before decision', () => {
    expect(resolveWorkflowV2AgentNext(spec, 'spec-produce')).toEqual({
      kind: 'goto',
      stepId: 'spec-review',
      routeId: 'agent:spec-produce:next'
    })
    expect(resolveWorkflowV2AgentNext(spec, 'spec-review')).toEqual({
      kind: 'goto',
      stepId: 'spec-decide',
      routeId: 'agent:spec-review:next'
    })
  })

  it('loops decision false until traversal budget exhausts to human', () => {
    expect(resolveWorkflowV2Decision(code, 'code-decide', '完成\nok', {})).toEqual({
      kind: 'end',
      outcome: 'succeeded'
    })
    expect(
      resolveWorkflowV2Decision(code, 'code-decide', '不完成\nagain', {
        'decision:code-decide:false': 0
      })
    ).toEqual({
      kind: 'goto',
      stepId: 'code-produce',
      routeId: 'decision:code-decide:false'
    })
    expect(
      resolveWorkflowV2Decision(code, 'code-decide', '不完成\nagain', {
        'decision:code-decide:false': 2
      })
    ).toEqual({
      kind: 'wait-human',
      stepId: 'code-human',
      exhaustedRouteId: 'decision:code-decide:false',
      exhaustedTargetStepId: 'code-produce'
    })
  })

  it('routes invalid binary decisions to human', () => {
    expect(resolveWorkflowV2Decision(spec, 'spec-decide', 'approve\nnope', {})).toEqual({
      kind: 'wait-human',
      stepId: 'spec-human'
    })
  })

  it('supports human approval', () => {
    expect(resolveWorkflowV2Human(spec, 'spec-human', 'approve')).toEqual({
      kind: 'end',
      outcome: 'succeeded'
    })
  })
})
