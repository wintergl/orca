import type {
  WorkflowArtifactRevision,
  WorkflowMessageSource,
  WorkflowReviewAggregate,
  WorkflowRunStatus,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus,
  WorkflowWaitingReason,
  WorkflowWorkspaceRef
} from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function workflowRunStatusLabel(status: WorkflowRunStatus): string {
  const labels: Record<WorkflowRunStatus, string> = {
    draft: translate('workflows.status.draft', 'Configuring'),
    ready: translate('workflows.status.ready', 'Ready'),
    running: translate('workflows.status.running', 'Running'),
    paused: translate('workflows.status.paused', 'Paused'),
    'waiting-human': translate('workflows.status.waitingHuman', 'Needs attention'),
    'review-limit-reached': translate('workflows.status.reviewLimit', 'Review limit'),
    completed: translate('workflows.status.completed', 'Completed'),
    failed: translate('workflows.status.failed', 'Failed'),
    cancelled: translate('workflows.status.cancelled', 'Cancelled')
  }
  return labels[status]
}

export function workflowStepStatusLabel(status: WorkflowStepRunStatus): string {
  const labels: Record<WorkflowStepRunStatus, string> = {
    queued: translate('workflows.stepStatus.queued', 'Queued'),
    'waiting-agent': translate('workflows.stepStatus.waitingAgent', 'Waiting for Agent'),
    delivering: translate('workflows.stepStatus.delivering', 'Delivering'),
    running: translate('workflows.stepStatus.running', 'Running'),
    'completion-incomplete': translate(
      'workflows.stepStatus.completionIncomplete',
      'Completion incomplete'
    ),
    succeeded: translate('workflows.stepStatus.succeeded', 'Succeeded'),
    'timed-out': translate('workflows.stepStatus.timedOut', 'Timed out'),
    cancelled: translate('workflows.stepStatus.cancelled', 'Cancelled'),
    failed: translate('workflows.stepStatus.failed', 'Failed')
  }
  return labels[status]
}

export function workflowWorkspaceKindLabel(kind: WorkflowWorkspaceRef['kind']): string {
  return kind === 'git-worktree'
    ? translate('workflows.workspaceKind.gitWorktree', 'Git worktree')
    : translate('workflows.workspaceKind.folderWorkspace', 'Folder workspace')
}

export function workflowNodeTypeLabel(type: WorkflowStepRunRecord['nodeType']): string {
  const labels: Record<WorkflowStepRunRecord['nodeType'], string> = {
    produce: translate('workflows.visual.produce', 'Produce'),
    review: translate('workflows.visual.review', 'Review'),
    decide: translate('workflows.visual.decide', 'Decide'),
    'human-gate': translate('workflows.visual.humanGate', 'Human gate'),
    complete: translate('workflows.visual.complete', 'Complete'),
    agent: translate('workflows.visual.kindAgent', 'Agent'),
    decision: translate('workflows.visual.kindDecision', 'Decision'),
    human: translate('workflows.visual.kindHuman', 'Human'),
    end: translate('workflows.visual.kindEnd', 'End')
  }
  return labels[type]
}

export function workflowReviewOutcomeLabel(outcome: WorkflowReviewAggregate['outcome']): string {
  const labels: Record<WorkflowReviewAggregate['outcome'], string> = {
    approve: translate('workflows.visual.resultApproved', 'Approved'),
    revise: translate('workflows.visual.resultNeedsChanges', 'Needs changes'),
    'request-human': translate('workflows.visual.resultNeedsHuman', 'Needs human review')
  }
  return labels[outcome]
}

export function workflowWaitingReasonLabel(reason: WorkflowWaitingReason): string {
  const labels: Record<WorkflowWaitingReason, string> = {
    'review-request-human': translate(
      'workflows.visual.reasonHumanRequested',
      'Review needs human control'
    ),
    'review-revision-required': translate('workflows.visual.reasonRevision', 'Revision required'),
    'review-conflict': translate('workflows.visual.reasonConflict', 'Review conflict'),
    'review-limit-reached': translate('workflows.visual.reasonReviewLimit', 'Review limit reached'),
    'agent-unavailable': translate('workflows.visual.reasonAgentUnavailable', 'Agent unavailable'),
    'lifecycle-mismatch': translate(
      'workflows.visual.reasonSessionChanged',
      'Agent session changed'
    ),
    'permission-required': translate('workflows.visual.reasonPermission', 'Permission required'),
    'transport-disconnected': translate(
      'workflows.visual.reasonDisconnected',
      'Transport disconnected'
    ),
    'reviewer-retry-exhausted': translate(
      'workflows.visual.reasonReviewerFailed',
      'Reviewer retries exhausted'
    ),
    'decision-invalid': translate('workflows.visual.reasonInvalidDecision', 'Invalid decision'),
    'delivery-uncertain': translate('workflows.visual.reasonDeliveryUnclear', 'Delivery uncertain'),
    'artifact-unavailable': translate(
      'workflows.visual.reasonResultMissing',
      'Artifact unavailable'
    ),
    'artifact-drifted': translate('workflows.visual.reasonResultChanged', 'Artifact changed'),
    'completion-incomplete': translate(
      'workflows.visual.reasonReportIncomplete',
      'Completion report incomplete'
    )
  }
  return labels[reason]
}

export function workflowArtifactStateLabel(
  state: WorkflowArtifactRevision['snapshotState']
): string {
  const labels: Record<WorkflowArtifactRevision['snapshotState'], string> = {
    frozen: translate('workflows.artifactState.frozen', 'Frozen'),
    drifted: translate('workflows.artifactState.drifted', 'Changed'),
    unavailable: translate('workflows.artifactState.unavailable', 'Unavailable')
  }
  return labels[state]
}

export function workflowMessageSourceLabel(source: WorkflowMessageSource): string {
  const labels: Record<WorkflowMessageSource, string> = {
    'report-path': translate('workflows.messageSource.reportPath', 'Report file'),
    'agent-final-message': translate(
      'workflows.messageSource.agentFinalMessage',
      'Agent final message'
    ),
    transcript: translate('workflows.messageSource.transcript', 'Transcript')
  }
  return labels[source]
}

export function workflowRuntimeValueLabel(value: 'engine' | 'pending' | 'none'): string {
  const labels = {
    engine: translate('workflows.runtime.engine', 'Engine'),
    pending: translate('workflows.runtime.pending', 'Pending'),
    none: translate('workflows.runtime.none', 'None')
  }
  return labels[value]
}

export function workflowExecutionHostLabel(executionHostId: string): string {
  return executionHostId === 'local'
    ? translate('workflows.runtime.localHost', 'Local host')
    : executionHostId
}
