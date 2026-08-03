import type { WorkflowTemplateSnapshot } from '../../../shared/workflow-definition-types'
import { isWorkflowDefinitionV2 } from '../../../shared/workflow-definition-v2-schema'
import { validateWorkflowPromptBoundaries } from '../../../shared/workflow-prompt-boundary-validation'
import { validateWorkflowV2Graph } from '../../../shared/workflow-v2-graph-validation'
import { WorkflowError } from './workflow-error'

export function assertWorkflowTemplateBoundaries(definition: WorkflowTemplateSnapshot): void {
  const promptIssues = validateWorkflowPromptBoundaries(definition)
  const graphIssues = isWorkflowDefinitionV2(definition) ? validateWorkflowV2Graph(definition) : []
  if (promptIssues.length || graphIssues.length) {
    throw new WorkflowError(
      'workflow_definition_invalid',
      [...promptIssues.map((issue) => `${issue.nodeId}: ${issue.message}`), ...graphIssues].join(
        '; '
      )
    )
  }
}
