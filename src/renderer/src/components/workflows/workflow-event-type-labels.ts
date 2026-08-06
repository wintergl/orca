import type { WorkflowEventType } from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function workflowEventTypeLabel(type: WorkflowEventType): string {
  const labels: Record<WorkflowEventType, string> = {
    'run-created': translate('workflows.event.runCreated', 'Run created'),
    'run-configuration-updated': translate(
      'workflows.event.runConfigurationUpdated',
      'Run configuration updated'
    ),
    'template-applied': translate('workflows.event.templateApplied', 'Template applied'),
    'agent-assigned': translate('workflows.event.agentAssigned', 'Agent assigned'),
    'run-started': translate('workflows.event.runStarted', 'Run started'),
    'prompt-delivery-started': translate(
      'workflows.event.promptDeliveryStarted',
      'Prompt delivery started'
    ),
    'prompt-delivered': translate('workflows.event.promptDelivered', 'Prompt delivered'),
    'step-working': translate('workflows.event.stepWorking', 'Step working'),
    'step-completed': translate('workflows.event.stepCompleted', 'Step completed'),
    'run-completed': translate('workflows.event.runCompleted', 'Run completed'),
    'run-failed': translate('workflows.event.runFailed', 'Run failed'),
    'completion-incomplete': translate(
      'workflows.event.completionIncomplete',
      'Completion incomplete'
    ),
    'artifact-drifted': translate('workflows.event.artifactDrifted', 'Artifact changed'),
    'review-fan-out': translate('workflows.event.reviewFanOut', 'Review tasks dispatched'),
    'review-collected': translate('workflows.event.reviewCollected', 'Review collected'),
    'review-aggregate-created': translate(
      'workflows.event.reviewAggregateCreated',
      'Review aggregate created'
    ),
    'review-waiting': translate('workflows.event.reviewWaiting', 'Review waiting'),
    'reviewer-failed': translate('workflows.event.reviewerFailed', 'Reviewer failed'),
    'reviewer-timed-out': translate('workflows.event.reviewerTimedOut', 'Reviewer timed out'),
    'decision-made': translate('workflows.event.decisionMade', 'Decision made'),
    'revision-requested': translate('workflows.event.revisionRequested', 'Revision requested'),
    'human-action': translate('workflows.event.humanAction', 'Human action'),
    'route-budget-extended': translate(
      'workflows.event.routeBudgetExtended',
      'Route budget extended'
    ),
    'agent-reassigned': translate('workflows.event.agentReassigned', 'Agent reassigned'),
    'step-retried': translate('workflows.event.stepRetried', 'Step retried'),
    'run-paused': translate('workflows.event.runPaused', 'Run paused'),
    'run-resumed': translate('workflows.event.runResumed', 'Run resumed'),
    'run-cancelled': translate('workflows.event.runCancelled', 'Run cancelled'),
    'run-recovery-started': translate('workflows.event.runRecoveryStarted', 'Run recovery started'),
    'run-recovered': translate('workflows.event.runRecovered', 'Run recovered'),
    'recovery-waiting': translate('workflows.event.recoveryWaiting', 'Recovery waiting'),
    'review-limit-reached': translate('workflows.event.reviewLimitReached', 'Review limit reached'),
    'late-completion-ignored': translate(
      'workflows.event.lateCompletionIgnored',
      'Late completion ignored'
    )
  }
  return labels[type]
}
