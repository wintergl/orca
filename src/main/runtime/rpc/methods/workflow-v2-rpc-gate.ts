import type { RpcContext } from '../core'
import { workflowDefinitionV2Schema } from '../../../../shared/workflow-definition-v2-schema'
import { isWorkflowV2FeatureEnabled } from '../../../../shared/workflow-feature-gates'
import { WorkflowError } from '../../workflows/workflow-error'

export function assertWorkflowV2RpcGate(context: RpcContext, definition: unknown): void {
  const enabled = isWorkflowV2FeatureEnabled(
    context.runtime.getClientSettings() as { 'workflows.v2.enabled'?: boolean }
  )
  const isV2 = workflowDefinitionV2Schema.safeParse(definition).success
  if (isV2 && !enabled) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Workflow V2 is disabled on this runtime host.'
    )
  }
}
