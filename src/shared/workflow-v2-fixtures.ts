import codeReviewJson from './workflow-fixtures/v2.code-review.json'
import specReviewJson from './workflow-fixtures/v2.spec-review.json'
import { parseWorkflowDefinitionV2 } from './workflow-definition-v2-schema'
import type { WorkflowDefinitionV2 } from './workflow-definition-v2-types'

export type WorkflowV2TemplateFixture = {
  id: string
  name: string
  scope: 'built-in'
  version: number
  definition: WorkflowDefinitionV2
}

function parseFixture(raw: {
  id: string
  name: string
  scope: 'built-in'
  version: number
  definition: unknown
}): WorkflowV2TemplateFixture {
  return {
    id: raw.id,
    name: raw.name,
    scope: 'built-in',
    version: raw.version,
    definition: parseWorkflowDefinitionV2(raw.definition)
  }
}

export const BUILTIN_WORKFLOW_V2_TEMPLATES: readonly WorkflowV2TemplateFixture[] = Object.freeze([
  parseFixture(specReviewJson as WorkflowV2TemplateFixture),
  parseFixture(codeReviewJson as WorkflowV2TemplateFixture)
])

export const RETIRED_BUILTIN_WORKFLOW_V2_TEMPLATE_IDS = Object.freeze([
  'builtin.v2.single-agent-end',
  'builtin.v2.agent-decision-loop',
  'builtin.v2.multi-agent-human'
])

export function getBuiltinWorkflowV2Template(
  templateId: string
): WorkflowV2TemplateFixture | undefined {
  return BUILTIN_WORKFLOW_V2_TEMPLATES.find((template) => template.id === templateId)
}
