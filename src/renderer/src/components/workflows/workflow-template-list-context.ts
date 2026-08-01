import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { WorkflowPage } from './workflow-renderer-state'

export function resolveWorkflowTemplateListContext(params: {
  page: WorkflowPage
  activeRun: WorkflowRunRecord | null
  runTarget: RuntimeClientTarget
  workspaceTarget: RuntimeClientTarget
  workspaceProjectIdentity?: string
}): { target: RuntimeClientTarget; projectIdentity?: string } {
  if (params.page === 'application' && params.activeRun) {
    return {
      target: params.runTarget,
      projectIdentity: params.activeRun.projectIdentity
    }
  }
  return {
    target: params.workspaceTarget,
    projectIdentity: params.workspaceProjectIdentity
  }
}
