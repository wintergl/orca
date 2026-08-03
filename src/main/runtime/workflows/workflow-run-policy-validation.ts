import type { WorkflowTemplateSnapshot } from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import type { WorkflowRunPolicyOverrides } from '../../../shared/workflow-run-lineage'
import { WorkflowError } from './workflow-error'

export function assertWorkflowRunPolicyMatchesSnapshot(
  snapshot: WorkflowTemplateSnapshot,
  policy: WorkflowRunPolicyOverrides | null
): void {
  if (!policy) {
    return
  }
  const expected = isWorkflowRunSnapshotV2(snapshot) ? 'v2-route-traversals' : 'v1-review-rounds'
  if (policy.policyVersion !== expected) {
    throw new WorkflowError(
      'workflow_context_mismatch',
      `Run snapshot requires ${expected} policy overrides.`
    )
  }
}
