import type {
  WorkflowPreflightCheck,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import type { WorkflowAgentUnavailableReason } from './workflow-agent-assignment-availability'
import { buildWorkflowV1PreflightChecks } from './workflow-preflight-v1'
import { buildWorkflowV2PreflightChecks } from './workflow-preflight-v2'

export function buildWorkflowPreflightChecks(
  run: WorkflowRunRecord,
  context: {
    workspaceAvailable: boolean
    capabilityAvailable: boolean
    unavailableAgentLifecycleIds: string[]
    unavailableAgentReasons?: Record<string, WorkflowAgentUnavailableReason>
  }
): WorkflowPreflightCheck[] {
  if (isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    return buildWorkflowV2PreflightChecks(run, context)
  }
  return buildWorkflowV1PreflightChecks(run, context)
}
