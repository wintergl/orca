import specReviewJson from './workflow-fixtures/builtin.spec-review.v1.json'
import codeReviewJson from './workflow-fixtures/builtin.code-review.v1.json'
import specToCodeReviewJson from './workflow-fixtures/builtin.spec-to-code-review.v1.json'
import { parseWorkflowTemplateFixtureV1 } from './workflow-definition-schema'
import type { WorkflowTemplateFixtureV1 } from './workflow-definition-types'

export const BUILTIN_WORKFLOW_TEMPLATES: readonly WorkflowTemplateFixtureV1[] = Object.freeze([
  parseWorkflowTemplateFixtureV1(specReviewJson),
  parseWorkflowTemplateFixtureV1(codeReviewJson),
  parseWorkflowTemplateFixtureV1(specToCodeReviewJson)
])

export function getBuiltinWorkflowTemplate(
  templateId: string
): WorkflowTemplateFixtureV1 | undefined {
  return BUILTIN_WORKFLOW_TEMPLATES.find((template) => template.id === templateId)
}
