import type {
  WorkflowAgentAssignment,
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowResolutionAction,
  WorkflowWaitingReason,
  WorkflowWorkspaceRef
} from './workflow-definition-types'
import type { WorkflowArtifactRevision } from './workflow-artifact-types'
import type {
  WorkflowDecisionRecord,
  WorkflowResolutionContext,
  WorkflowReviewAggregate
} from './workflow-review-types'
import type {
  WorkflowRunPolicyOverridesV1,
  WorkflowRunPromptOverrides
} from './workflow-run-lineage'

export type WorkflowRunStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'paused'
  | 'waiting-human'
  | 'review-limit-reached'
  | 'cancelled'
  | 'completed'
  | 'failed'

export type WorkflowStepRunStatus =
  | 'queued'
  | 'waiting-agent'
  | 'delivering'
  | 'running'
  | 'completion-incomplete'
  | 'succeeded'
  | 'timed-out'
  | 'cancelled'
  | 'failed'

export type WorkflowDeliveryState = 'prepared' | 'delivering' | 'delivered' | 'uncertain' | 'failed'

export type WorkflowEventType =
  | 'run-created'
  | 'template-applied'
  | 'agent-assigned'
  | 'run-started'
  | 'prompt-delivery-started'
  | 'prompt-delivered'
  | 'step-working'
  | 'step-completed'
  | 'run-completed'
  | 'run-failed'
  | 'completion-incomplete'
  | 'artifact-drifted'
  | 'review-fan-out'
  | 'review-collected'
  | 'review-aggregate-created'
  | 'review-waiting'
  | 'reviewer-failed'
  | 'reviewer-timed-out'
  | 'decision-made'
  | 'revision-requested'
  | 'human-action'
  | 'agent-reassigned'
  | 'step-retried'
  | 'run-paused'
  | 'run-resumed'
  | 'run-cancelled'
  | 'run-recovery-started'
  | 'run-recovered'
  | 'recovery-waiting'
  | 'review-limit-reached'
  | 'late-completion-ignored'

export type WorkflowMessageSource = 'report-path' | 'agent-final-message' | 'transcript'

export type WorkflowStepRunRecord = {
  id: string
  runId: string
  nodeId: string
  nodeName: string
  nodeType: WorkflowNodeDefinitionV1['type']
  round: number
  attempt: number
  status: WorkflowStepRunStatus
  assignment: WorkflowAgentAssignment | null
  orchestrationRunId: string | null
  taskId: string | null
  dispatchId: string | null
  deliveryId: string
  deliveryState: WorkflowDeliveryState
  prompt: string
  conclusionMarkdown: string | null
  resultEnvelope: unknown
  messageSource: WorkflowMessageSource | null
  messageDigest: string | null
  sourceIdentity: string | null
  sourceWarnings: string[]
  inputArtifactRevisionId: string | null
  outputArtifactRevisionId: string | null
  errorCode: string | null
  errorMessage: string | null
  recovery: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkflowEventRecord = {
  id: string
  runId: string
  sequence: number
  type: WorkflowEventType
  stepRunId: string | null
  payload: unknown
  createdAt: string
}

export type WorkflowResolutionOffer = {
  id: string
  runId: string
  waitingReason: WorkflowWaitingReason
  action: WorkflowResolutionAction
  originDecisionStepId: string
  reviewNodeId: string
  resolutionTransitionId: string
  expectedRunVersion: number
  preconditions: string[]
  requiresReason: boolean
  requiresConfirmation: boolean
  requiredPermission: 'workflow-operate' | 'workflow-approve'
  expiresAt: string
}

export type WorkflowRunRecord = {
  id: string
  status: WorkflowRunStatus
  version: number
  templateId: string
  templateVersion: number
  templateName: string
  /** V1 execution snapshot. V2 free-form graphs are template-only until the V2 run path is enabled. */
  templateSnapshot: WorkflowDefinitionV1
  ownerIdentity: string
  projectIdentity: string
  workspace: WorkflowWorkspaceRef
  executionHostId: string
  objective: string
  assignments: WorkflowAgentAssignment[]
  currentNodeId: string | null
  orchestrationRunId: string | null
  waitingReason: WorkflowWaitingReason | null
  resolutionContext: WorkflowResolutionContext | null
  resolutionOffers: WorkflowResolutionOffer[]
  reviewRoundsByNodeId: Record<string, number>
  reviewRoundExtensionsByNodeId: Record<string, number>
  /** P1 lineage: null for ordinary root runs. */
  parentRunId: string | null
  rootRunId: string
  lineageCycleBase: number
  rerunReason: string | null
  noAdditionalRequirements: boolean
  policyOverrides: WorkflowRunPolicyOverridesV1 | null
  promptOverrides: WorkflowRunPromptOverrides | null
  failureCode: string | null
  failureMessage: string | null
  recovery: string | null
  startedAt: string | null
  completedAt: string | null
  steps: WorkflowStepRunRecord[]
  artifacts: WorkflowArtifactRevision[]
  reviewAggregates: WorkflowReviewAggregate[]
  decisions: WorkflowDecisionRecord[]
  createdAt: string
  updatedAt: string
}

export type WorkflowRunEventsResult = {
  runId: string
  events: WorkflowEventRecord[]
}

export type WorkflowRunHistoryFilter = {
  projectIdentity?: string
  workspace?: WorkflowWorkspaceRef
  templateId?: string
  statuses?: WorkflowRunStatus[]
  createdFrom?: string
  createdTo?: string
  limit?: number
}

export type WorkflowRunSummary = {
  id: string
  status: WorkflowRunStatus
  templateId: string
  templateVersion: number
  templateName: string
  projectIdentity: string
  workspace: WorkflowWorkspaceRef
  executionHostId: string
  objective: string
  currentNodeId: string | null
  waitingReason: WorkflowWaitingReason | null
  parentRunId: string | null
  rootRunId: string
  isRerun: boolean
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkflowRunExportFormat = 'markdown' | 'json'

export type WorkflowRunExportResult = {
  runId: string
  format: WorkflowRunExportFormat
  filename: string
  mimeType: string
  content: string
  digest: string
  size: number
}

export type WorkflowPreflightCheck = {
  id:
    | 'required-slots'
    | 'minimum-agents'
    | 'objective'
    | 'template-snapshot'
    | 'workspace-context'
    | 'agent-availability'
    | 'review-bounds'
    | 'workflow-exit'
    | 'workspace-capability'
    | 'decision-protocol'
  status: 'passed' | 'failed'
  nodeId: string | null
  message: string
  recovery: string | null
}

export type WorkflowPreflightResult = {
  ready: boolean
  checks: WorkflowPreflightCheck[]
  run: WorkflowRunRecord
}
