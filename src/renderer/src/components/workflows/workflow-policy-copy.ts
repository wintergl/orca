import type {
  WorkflowResolutionAction,
  WorkflowWaitingReason
} from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function waitingReasonLabel(reason: WorkflowWaitingReason): string {
  const labels: Record<WorkflowWaitingReason, string> = {
    'review-request-human': translate(
      'workflows.visual.reasonHumanRequested',
      'Review needs a person'
    ),
    'review-revision-required': translate(
      'workflows.visual.reasonRevision',
      'Changes are required'
    ),
    'review-conflict': translate('workflows.visual.reasonConflict', 'Reviewers disagree'),
    'review-limit-reached': translate('workflows.visual.reasonReviewLimit', 'Review limit reached'),
    'agent-unavailable': translate('workflows.visual.reasonAgentUnavailable', 'Agent unavailable'),
    'lifecycle-mismatch': translate(
      'workflows.visual.reasonSessionChanged',
      'Agent session changed'
    ),
    'permission-required': translate('workflows.visual.reasonPermission', 'Permission needed'),
    'transport-disconnected': translate('workflows.visual.reasonDisconnected', 'Connection lost'),
    'reviewer-retry-exhausted': translate(
      'workflows.visual.reasonReviewerFailed',
      'Reviewer retries failed'
    ),
    'decision-invalid': translate('workflows.visual.reasonInvalidDecision', 'Decision is invalid'),
    'delivery-uncertain': translate(
      'workflows.visual.reasonDeliveryUnclear',
      'Delivery is uncertain'
    ),
    'artifact-unavailable': translate(
      'workflows.visual.reasonResultMissing',
      'Result is unavailable'
    ),
    'artifact-drifted': translate('workflows.visual.reasonResultChanged', 'Result changed'),
    'completion-incomplete': translate(
      'workflows.visual.reasonReportIncomplete',
      'Completion report is incomplete'
    )
  }
  return labels[reason]
}

export function resolutionActionLabel(action: WorkflowResolutionAction): string {
  const labels: Record<WorkflowResolutionAction, string> = {
    'view-evidence': translate('workflows.visual.actionViewEvidence', 'View evidence'),
    approve: translate('workflows.visual.actionApprove', 'Approve'),
    revise: translate('workflows.visual.actionRevise', 'Request changes'),
    'continue-round': translate('workflows.visual.actionContinueReview', 'Continue review'),
    'retry-step': translate('workflows.visual.actionRetry', 'Retry step'),
    'retry-with-duplicate-risk': translate(
      'workflows.visual.actionRetryRisk',
      'Retry with duplicate risk'
    ),
    'reassign-agent': translate('workflows.visual.actionReassign', 'Choose another Agent'),
    'wait-for-reconnect': translate('workflows.visual.actionWaitReconnect', 'Wait for reconnect'),
    'resolve-permission': translate('workflows.visual.actionPermission', 'Resolve permission'),
    'regenerate-artifact': translate('workflows.visual.actionRegenerate', 'Regenerate result'),
    'end-workflow': translate('workflows.visual.actionEnd', 'End workflow')
  }
  return labels[action]
}
