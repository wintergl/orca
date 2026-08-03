import type { RpcContext } from '../core'
import { workflowDefinitionV2Schema } from '../../../../shared/workflow-definition-v2-schema'
import { isWorkflowV2FeatureEnabled } from '../../../../shared/workflow-feature-gates'
import { WorkflowError } from '../../workflows/workflow-error'

export function assertWorkflowV2RpcGate(
  context: RpcContext,
  definition: unknown,
  operation: 'run' | 'template-mutation' = 'run'
): void {
  const enabled = isWorkflowV2FeatureEnabled(
    context.runtime.getClientSettings() as { 'workflows.v2.enabled'?: boolean }
  )
  const isV2 = workflowDefinitionV2Schema.safeParse(definition).success
  const claimsV2 =
    Boolean(definition) &&
    typeof definition === 'object' &&
    (definition as { schemaVersion?: unknown }).schemaVersion === 2
  if (isV2 && !enabled) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Workflow V2 is disabled on this runtime host.'
    )
  }
  if (claimsV2) {
    // Let the template parser report malformed V2 definitions precisely.
    return
  }
  if (!isV2 && enabled && operation === 'template-mutation') {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Workflow V1 templates are read-only after Workflow V2 is enabled.'
    )
  }
}
