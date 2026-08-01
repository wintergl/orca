import { describe, expect, it } from 'vitest'
import { WorkflowDecisionV1Schema } from './workflow-result-schema'

const validDecision = {
  schema: 'workflow.decision/v1',
  taskId: 'task-1',
  dispatchId: 'dispatch-1',
  workflowRunId: 'run-1',
  stepRunId: 'step-1',
  agentLifecycleId: 'agent-1',
  providerSessionId: 'session-1',
  executionHostId: 'local',
  reviewAggregateId: 'aggregate-1',
  decision: 'revise',
  issues: ['Keep the frozen source issue.'],
  conflicts: [],
  conclusionMarkdown: 'Revise the Artifact using the bounded issue list.'
} as const

describe('WorkflowDecisionV1Schema', () => {
  it('accepts only the four frozen decisions', () => {
    for (const decision of ['approve', 'revise', 'request-human', 'stop-at-review'] as const) {
      expect(WorkflowDecisionV1Schema.parse({ ...validDecision, decision }).decision).toBe(decision)
    }
  })

  it('rejects guessed, structural, and overreaching decisions', () => {
    for (const decision of ['merge', 'create-node', 'round:99', 'approved-ish']) {
      expect(
        WorkflowDecisionV1Schema.safeParse({ ...validDecision, decision }).success,
        decision
      ).toBe(false)
    }
    expect(
      WorkflowDecisionV1Schema.safeParse({
        ...validDecision,
        decision: 'approve',
        nextNodeId: 'undeclared-node'
      }).success
    ).toBe(false)
  })
})
