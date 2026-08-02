import { z } from 'zod'
import {
  WORKFLOW_PROMPT_TEMPLATE_KEYS,
  WORKFLOW_RESOLUTION_ACTIONS,
  WORKFLOW_WAITING_REASONS,
  type WorkflowDefinitionV1,
  type WorkflowTemplateFixtureV1
} from './workflow-definition-types'
import { validateWorkflowDefinition } from './workflow-definition-validation'
import { WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH } from './workflow-prompt-instructions'

const idSchema = z.string().trim().min(1).max(120)
const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(0).max(20),
    backoffMs: z.number().int().min(0).max(3_600_000),
    onExhausted: z.enum(['fail-run', 'wait-human'])
  })
  .strict()

export const workflowReviewPolicyV1Schema = z
  .object({
    minReviewers: z.number().int().min(1).max(8),
    completion: z.literal('all-required'),
    onReviewerFailure: z.enum(['fail-run', 'wait-human']),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).nullable(),
    maxReviewRounds: z.number().int().min(1).max(20)
  })
  .strict()

const roleSlotSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(120),
    required: z.boolean(),
    minAgents: z.number().int().min(0).max(8),
    maxAgents: z.number().int().min(1).max(8),
    execution: z.enum(['single', 'parallel', 'sequential']),
    allowedAgentStates: z.tuple([z.literal('idle')])
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.minAgents > slot.maxAgents) {
      context.addIssue({ code: 'custom', message: 'minAgents cannot exceed maxAgents' })
    }
    if (slot.required && slot.minAgents < 1) {
      context.addIssue({ code: 'custom', message: 'Required role slots need at least one agent' })
    }
    if (!slot.required && slot.minAgents !== 0) {
      context.addIssue({ code: 'custom', message: 'Optional role slots must allow zero agents' })
    }
    if (slot.execution === 'single' && slot.maxAgents !== 1) {
      context.addIssue({ code: 'custom', message: 'Single role slots allow exactly one agent' })
    }
  })

const inputBindingSchema = z.enum([
  'root-goal',
  'upstream-completion',
  'artifact-revision',
  'review-aggregate',
  'decision'
])

const promptRulesSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().trim().min(1).max(120),
            when: z.enum(['first-visit', 'repeat-visit', 'always']),
            template: z.string().trim().min(1).max(WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH)
          })
          .strict()
      )
      .min(1)
      .max(3),
    completionCriteria: z.string().trim().min(1).max(4_000)
  })
  .strict()
  .superRefine((prompt, context) => {
    const conditions = new Set<string>()
    for (const rule of prompt.rules) {
      if (conditions.has(rule.when)) {
        context.addIssue({
          code: 'custom',
          path: ['rules'],
          message: `Only one ${rule.when} prompt rule is allowed`
        })
      }
      conditions.add(rule.when)
    }
  })

const nodeBase = {
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  roleSlotIds: z.array(idSchema).max(8),
  promptTemplateKey: z.enum(WORKFLOW_PROMPT_TEMPLATE_KEYS).nullable(),
  promptInstructions: z
    .string()
    .trim()
    .min(1)
    .max(WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH)
    .nullable()
    .optional(),
  promptRules: promptRulesSchema.optional(),
  inputBindings: z.array(inputBindingSchema).max(8),
  retryPolicy: retryPolicySchema
}

const nodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...nodeBase,
      type: z.literal('produce'),
      artifactKind: z.enum(['spec', 'code']),
      outputSchema: z.literal('workflow.completion/v1')
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('review'),
      reviewPolicy: workflowReviewPolicyV1Schema,
      outputSchema: z.literal('workflow.review-result/v1')
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('decide'),
      mode: z.enum(['rules', 'rules-then-agent']),
      outputSchema: z.literal('workflow.decision/v1')
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('human-gate'),
      waitingReasons: z.array(z.enum(WORKFLOW_WAITING_REASONS)).min(1),
      allowedActions: z.array(z.enum(WORKFLOW_RESOLUTION_ACTIONS)).min(1),
      outputSchema: z.literal('workflow.human-resolution/v1')
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('complete'),
      outcome: z.literal('succeeded'),
      outputSchema: z.null()
    })
    .strict()
])

const transitionSchema = z
  .object({
    id: idSchema,
    from: idSchema,
    when: z.enum([
      'step:succeeded',
      'decision:approve',
      'decision:revise',
      'decision:request-human',
      'decision:stop-at-review',
      'human:approve',
      'human:revise',
      'human:end'
    ]),
    to: idSchema
  })
  .strict()

export const workflowDefinitionV1Schema = z
  .object({
    schemaVersion: z.literal(1, {
      error: 'Unsupported workflow schema version; upgrade Orca to edit it'
    }),
    decisionProtocolVersion: z.enum(['v1-approve-revise', 'v2-binary-zh']).optional(),
    entryNodeId: idSchema,
    defaults: z.object({ retryPolicy: retryPolicySchema }).strict(),
    roleSlots: z.array(roleSlotSchema).min(1).max(24),
    nodes: z.array(nodeSchema).min(2).max(60),
    transitions: z.array(transitionSchema).min(1).max(160)
  })
  .strict()
  .superRefine(validateWorkflowDefinition)

export const workflowTemplateFixtureV1Schema = z
  .object({
    id: z.enum([
      'builtin.spec-review.v1',
      'builtin.code-review.v1',
      'builtin.spec-to-code-review.v1'
    ]),
    name: z.enum(['SPEC 编写与评审', '代码实现与评审', 'SPEC → 实现完整流程']),
    scope: z.literal('built-in'),
    version: z.number().int().positive(),
    definition: workflowDefinitionV1Schema
  })
  .strict()

export function parseWorkflowDefinitionV1(value: unknown): WorkflowDefinitionV1 {
  return workflowDefinitionV1Schema.parse(value) as WorkflowDefinitionV1
}

export function parseWorkflowTemplateFixtureV1(value: unknown): WorkflowTemplateFixtureV1 {
  return workflowTemplateFixtureV1Schema.parse(value) as WorkflowTemplateFixtureV1
}
