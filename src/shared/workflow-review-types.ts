export type WorkflowReviewAggregate = {
  schema: 'workflow.review-aggregate/v1'
  id: string
  reviewNodeId: string
  round: number
  artifactRevisionId: string
  reviewerStepRunIds: string[]
  outcome: 'approve' | 'revise' | 'request-human'
  conflicts: string[]
  waitingReason: null | 'review-request-human' | 'review-revision-required' | 'review-conflict'
  content: string
  createdAt: string
}

export type WorkflowResolutionContext = {
  originDecisionStepId: string
  originDecisionNodeId: string
  reviewNodeId: string
  artifactRevisionId: string
  approveTransitionId: string
  reviseTransitionId: string
}

export type WorkflowDecision = 'approve' | 'revise' | 'request-human' | 'stop-at-review'

export type WorkflowDecisionRecord = {
  id: string
  runId: string
  stepRunId: string
  reviewAggregateId: string
  ruleVersion: string
  deterministicDecision: WorkflowDecision
  finalDecision: WorkflowDecision
  source: 'rules' | 'agent' | 'human'
  input: unknown
  createdAt: string
}
