import type { WorkflowPreflightCheck } from '../../../shared/workflow-definition-types'

export function preflightCheck(
  id: WorkflowPreflightCheck['id'],
  passed: boolean,
  message: string,
  recovery: string | null
): WorkflowPreflightCheck {
  return {
    id,
    status: passed ? 'passed' : 'failed',
    nodeId: null,
    message,
    recovery: passed ? null : recovery
  }
}
