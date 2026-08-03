import { z } from 'zod'
import type { WorkflowDefinitionV2 } from './workflow-definition-v2-types'
import { WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH } from './workflow-prompt-instructions'

const idSchema = z.string().trim().min(1).max(120)
const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(0).max(20),
    backoffMs: z.number().int().min(0).max(3_600_000).default(0),
    onExhausted: z.enum(['fail-run', 'human'])
  })
  .strict()

const promptSchema = z
  .object({
    variants: z
      .array(
        z
          .object({
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

const routeSchema = z
  .object({
    targetStepId: idSchema,
    maxTraversals: z.number().int().min(0).max(50).optional(),
    onExhaustedStepId: idSchema.optional()
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

const agentStepSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.literal('agent'),
    roleSlotIds: z.array(idSchema).min(1).max(8),
    execution: z.enum(['single', 'parallel', 'sequential']),
    prompt: promptSchema,
    retryPolicy: retryPolicySchema,
    next: routeSchema
  })
  .strict()

const decisionStepSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.literal('decision'),
    roleSlotIds: z.tuple([idSchema]),
    prompt: promptSchema,
    parser: z.literal('binary-complete'),
    routes: z
      .object({
        whenTrue: routeSchema,
        whenFalse: routeSchema,
        whenInvalid: routeSchema
      })
      .strict(),
    retryPolicy: retryPolicySchema
  })
  .strict()

const humanStepSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.literal('human'),
    routes: z
      .array(
        z
          .object({
            id: idSchema,
            label: z.string().trim().min(1).max(120),
            targetStepId: idSchema,
            requiresText: z.boolean(),
            requiresConfirmation: z.boolean()
          })
          .strict()
      )
      .min(1)
      .max(12)
  })
  .strict()

const endStepSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.literal('end'),
    outcome: z.enum(['succeeded', 'cancelled', 'failed']).default('succeeded')
  })
  .strict()

const stepSchema = z.discriminatedUnion('kind', [
  agentStepSchema,
  decisionStepSchema,
  humanStepSchema,
  endStepSchema
])

export const workflowDefinitionV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    decisionProtocolVersion: z.literal('v2-binary-zh'),
    entryStepId: idSchema,
    roleSlots: z.array(roleSlotSchema).min(1).max(24),
    steps: z.array(stepSchema).min(2).max(60)
  })
  .strict()
  .superRefine((definition, context) => {
    const ids = new Set<string>()
    for (const step of definition.steps) {
      if (ids.has(step.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate step id ${step.id}` })
      }
      ids.add(step.id)
    }
    if (!ids.has(definition.entryStepId)) {
      context.addIssue({ code: 'custom', message: 'entryStepId must reference a step' })
    }
    if (!definition.steps.some((step) => step.kind === 'end')) {
      context.addIssue({ code: 'custom', message: 'V2 workflow requires an end step' })
    }
    const slotIds = new Set(definition.roleSlots.map((slot) => slot.id))
    for (const step of definition.steps) {
      if (step.kind === 'agent' || step.kind === 'decision') {
        for (const slotId of step.roleSlotIds) {
          if (!slotIds.has(slotId)) {
            context.addIssue({
              code: 'custom',
              message: `Step ${step.id} references unknown role slot ${slotId}`
            })
          }
        }
      }
    }
  })

export function parseWorkflowDefinitionV2(value: unknown): WorkflowDefinitionV2 {
  return workflowDefinitionV2Schema.parse(value) as WorkflowDefinitionV2
}

export function isWorkflowDefinitionV2(value: unknown): value is WorkflowDefinitionV2 {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  )
}
