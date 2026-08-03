export type {
  WorkflowArtifactManifestEntryV1,
  WorkflowArtifactManifestV1,
  WorkflowArtifactRevision
} from './workflow-artifact-types'
export type {
  WorkflowDecision,
  WorkflowDecisionRecord,
  WorkflowResolutionContext,
  WorkflowReviewAggregate
} from './workflow-review-types'
export type {
  WorkflowEventRecord,
  WorkflowEventType,
  WorkflowDeliveryState,
  WorkflowMessageSource,
  WorkflowPreflightCheck,
  WorkflowPreflightResult,
  WorkflowResolutionOffer,
  WorkflowRunEventsResult,
  WorkflowRunExportFormat,
  WorkflowRunExportResult,
  WorkflowRunHistoryFilter,
  WorkflowRunRecord,
  WorkflowRunSummary,
  WorkflowRunStatus,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus
} from './workflow-runtime-types'

export const WORKFLOW_WAITING_REASONS = [
  'review-request-human',
  'review-revision-required',
  'review-conflict',
  'review-limit-reached',
  'agent-unavailable',
  'lifecycle-mismatch',
  'permission-required',
  'transport-disconnected',
  'reviewer-retry-exhausted',
  'decision-invalid',
  'delivery-uncertain',
  'artifact-unavailable',
  'artifact-drifted',
  'completion-incomplete'
] as const

export const WORKFLOW_RESOLUTION_ACTIONS = [
  'view-evidence',
  'approve',
  'revise',
  'continue-round',
  'retry-step',
  'retry-with-duplicate-risk',
  'reassign-agent',
  'wait-for-reconnect',
  'resolve-permission',
  'regenerate-artifact',
  'end-workflow'
] as const

export const WORKFLOW_PROMPT_TEMPLATE_KEYS = [
  'builtin.spec.produce.v1',
  'builtin.spec.review.v1',
  'builtin.spec.decide.v1',
  'builtin.code.produce.v1',
  'builtin.code.review.v1',
  'builtin.code.decide.v1'
] as const

export type WorkflowWaitingReason = (typeof WORKFLOW_WAITING_REASONS)[number]
export type WorkflowResolutionAction = (typeof WORKFLOW_RESOLUTION_ACTIONS)[number]
export type WorkflowPromptTemplateKey = (typeof WORKFLOW_PROMPT_TEMPLATE_KEYS)[number]

export type WorkflowRetryPolicy = {
  maxAttempts: number
  backoffMs: number
  onExhausted: 'fail-run' | 'wait-human'
}

export type WorkflowReviewPolicyV1 = {
  minReviewers: number
  completion: 'all-required'
  onReviewerFailure: 'fail-run' | 'wait-human'
  timeoutMs: number | null
  maxReviewRounds: number
}

export type WorkflowRoleSlot = {
  id: string
  label: string
  required: boolean
  minAgents: number
  maxAgents: number
  execution: 'single' | 'parallel' | 'sequential'
  allowedAgentStates: ['idle']
}

export type WorkflowInputBinding =
  | 'root-goal'
  | 'upstream-completion'
  | 'artifact-revision'
  | 'review-aggregate'
  | 'decision'

export type WorkflowPromptRuleWhen = 'first-visit' | 'repeat-visit' | 'always'

export type WorkflowPromptRuleV1 = {
  id: string
  name: string
  when: WorkflowPromptRuleWhen
  template: string
}

export type WorkflowPromptRulesV1 = {
  rules: WorkflowPromptRuleV1[]
  completionCriteria: string
}

export type WorkflowNodeBase = {
  id: string
  name: string
  roleSlotIds: string[]
  promptTemplateKey: WorkflowPromptTemplateKey | null
  promptInstructions?: string | null
  promptRules?: WorkflowPromptRulesV1
  inputBindings: WorkflowInputBinding[]
  retryPolicy: WorkflowRetryPolicy
}

export type WorkflowNodeDefinitionV1 =
  | (WorkflowNodeBase & {
      type: 'produce'
      artifactKind: 'spec' | 'code'
      outputSchema: 'workflow.completion/v1'
    })
  | (WorkflowNodeBase & {
      type: 'review'
      reviewPolicy: WorkflowReviewPolicyV1
      outputSchema: 'workflow.review-result/v1'
    })
  | (WorkflowNodeBase & {
      type: 'decide'
      mode: 'rules' | 'rules-then-agent'
      outputSchema: 'workflow.decision/v1'
    })
  | (WorkflowNodeBase & {
      type: 'human-gate'
      waitingReasons: WorkflowWaitingReason[]
      allowedActions: WorkflowResolutionAction[]
      outputSchema: 'workflow.human-resolution/v1'
    })
  | (WorkflowNodeBase & {
      type: 'complete'
      outcome: 'succeeded'
      outputSchema: null
    })

export type WorkflowTransitionV1 = {
  id: string
  from: string
  when:
    | 'step:succeeded'
    | 'decision:approve'
    | 'decision:revise'
    | 'decision:request-human'
    | 'decision:stop-at-review'
    | 'human:approve'
    | 'human:revise'
    | 'human:end'
  to: string | 'run:completed' | 'run:cancelled' | 'run:review-limit-reached'
}

export type WorkflowDefinitionV1 = {
  schemaVersion: 1
  /**
   * Canonical decision protocol for this template.
   * Missing = unversioned legacy V1 (Chinese aliases accepted at runtime).
   * Saves always stamp `v1-approve-revise` (P0).
   */
  decisionProtocolVersion?: 'v1-approve-revise' | 'v2-binary-zh'
  entryNodeId: string
  defaults: {
    retryPolicy: WorkflowRetryPolicy
  }
  roleSlots: WorkflowRoleSlot[]
  nodes: WorkflowNodeDefinitionV1[]
  transitions: WorkflowTransitionV1[]
}

export type { WorkflowDefinitionV2 } from './workflow-definition-v2-types'
import type { WorkflowDefinitionV2 } from './workflow-definition-v2-types'

/** Template/run snapshot may be V1 or V2 once the V2 gate is enabled. */
export type WorkflowTemplateSnapshot = WorkflowDefinitionV1 | WorkflowDefinitionV2

export type WorkflowTemplateScope = 'built-in' | 'personal' | 'project'

export type WorkflowTemplateFixtureV1 = {
  id: string
  name: string
  scope: 'built-in'
  version: number
  definition: WorkflowDefinitionV1
}

export type WorkflowAgentAssignment = {
  nodeId: string
  slotId: string
  worktreeId: string
  executionHostId: string
  paneKey: string
  agentLifecycleId: string
  providerSessionId: string | null
  runtimeAgent: string | null
}

export type WorkflowTemplateRecord = {
  id: string
  name: string
  scope: WorkflowTemplateScope
  ownerIdentity: string
  projectIdentity: string | null
  archivedAt: string | null
  archivedBy: string | null
  currentVersion: number
  definition: WorkflowTemplateSnapshot
  createdAt: string
  updatedAt: string
}

export type WorkflowWorkspaceRef = {
  kind: 'git-worktree' | 'folder-workspace'
  id: string
}
