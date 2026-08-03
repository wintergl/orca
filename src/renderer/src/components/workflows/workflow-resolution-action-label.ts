import type {
  WorkflowResolutionAction,
  WorkflowResolutionOffer
} from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

const FALLBACK_LABELS: Record<WorkflowResolutionAction, string> = {
  'view-evidence': 'View evidence',
  approve: 'Approve',
  revise: 'Return for revision',
  'continue-round': 'Continue one round',
  'retry-step': 'Retry step',
  'retry-with-duplicate-risk': 'Retry with duplicate risk',
  'reassign-agent': 'Reassign Agent',
  'wait-for-reconnect': 'Wait for reconnect',
  'resolve-permission': 'Resolve permission',
  'regenerate-artifact': 'Regenerate Artifact',
  'end-workflow': 'End Workflow'
}

export function workflowResolutionActionLabel(action: WorkflowResolutionAction): string {
  return translate(`workflows.resolution.action.${action}`, FALLBACK_LABELS[action])
}

export function workflowResolutionOfferLabel(offer: WorkflowResolutionOffer): string {
  const custom = offer.displayLabel?.trim()
  if (custom) {
    return custom
  }
  return workflowResolutionActionLabel(offer.action)
}
