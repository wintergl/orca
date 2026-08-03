/** Generic free-form workflow model (schemaVersion 2). */

export type WorkflowStepKindV2 = 'agent' | 'decision' | 'human' | 'end'

export type WorkflowRetryPolicyV2 = {
  maxAttempts: number
  backoffMs: number
  onExhausted: 'fail-run' | 'human'
}

export type WorkflowPromptVariantV2 = {
  when: 'first-visit' | 'repeat-visit' | 'always'
  template: string
}

export type WorkflowPromptV2 = {
  variants: WorkflowPromptVariantV2[]
  completionCriteria: string
  repeatVisitHistoryMode?: 'required' | 'not-required'
}

export type WorkflowRouteV2 = {
  targetStepId: string
  maxTraversals?: number
  onExhaustedStepId?: string
}

export type WorkflowDecisionRoutesV2 = {
  whenTrue: WorkflowRouteV2
  whenFalse: WorkflowRouteV2
  whenInvalid: WorkflowRouteV2
}

export type WorkflowHumanRouteV2 = {
  id: string
  label: string
  targetStepId: string
  requiresText: boolean
  requiresConfirmation: boolean
  maxTraversals?: number
  onExhaustedStepId?: string
}

export type WorkflowRoleSlotV2 = {
  id: string
  label: string
  required: boolean
  minAgents: number
  maxAgents: number
  execution: 'single' | 'parallel' | 'sequential'
  allowedAgentStates: ['idle']
}

export type WorkflowAgentStepV2 = {
  id: string
  name: string
  kind: 'agent'
  roleSlotIds: string[]
  execution: 'single' | 'parallel' | 'sequential'
  prompt: WorkflowPromptV2
  retryPolicy: WorkflowRetryPolicyV2
  next: WorkflowRouteV2
}

export type WorkflowDecisionStepV2 = {
  id: string
  name: string
  kind: 'decision'
  roleSlotIds: [string]
  prompt: WorkflowPromptV2
  parser: 'binary-complete'
  routes: WorkflowDecisionRoutesV2
  retryPolicy: WorkflowRetryPolicyV2
}

export type WorkflowHumanStepV2 = {
  id: string
  name: string
  kind: 'human'
  routes: WorkflowHumanRouteV2[]
}

export type WorkflowEndStepV2 = {
  id: string
  name: string
  kind: 'end'
  outcome: 'succeeded' | 'cancelled' | 'failed'
}

export type WorkflowStepDefinitionV2 =
  | WorkflowAgentStepV2
  | WorkflowDecisionStepV2
  | WorkflowHumanStepV2
  | WorkflowEndStepV2

export type WorkflowDefinitionV2 = {
  schemaVersion: 2
  decisionProtocolVersion: 'v2-binary-zh'
  entryStepId: string
  roleSlots: WorkflowRoleSlotV2[]
  steps: WorkflowStepDefinitionV2[]
}

export type WorkflowHistoryEntryV2 = {
  sequence: number
  stepId: string
  stepName: string
  stepKind: WorkflowStepKindV2
  visit: number
  cycle: number
  attempt: number
  promptText: string | null
  finalText: string
  agentOutputs: {
    slotId: string
    agentIdentity: string
    finalText: string
  }[]
  decision: boolean | null
  createdAt: string
}

export type WorkflowRunPolicyOverridesV2 = {
  policyVersion: 'v2-route-traversals'
  maxTraversalsByRouteId: Record<string, number>
}
