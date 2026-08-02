import { z } from 'zod'

const id = z.string().trim().min(1).max(180)
const requestId = z.string().trim().min(1).max(180)
const projectIdentity = z.string().trim().min(1).max(500)
const templateScope = z.enum(['personal', 'project'])
const mutationBase = { requestId }

export const templateListParams = z
  .object({
    projectIdentity: projectIdentity.optional(),
    includeArchived: z.boolean().optional()
  })
  .strict()
export const templateShowParams = z
  .object({ templateId: id, projectIdentity: projectIdentity.optional() })
  .strict()
export const templateCreateParams = z
  .object({
    ...mutationBase,
    name: z.string().trim().min(1).max(160),
    scope: templateScope,
    projectIdentity: projectIdentity.optional(),
    definition: z.unknown()
  })
  .strict()
export const templateUpdateParams = z
  .object({
    ...mutationBase,
    templateId: id,
    expectedVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(160),
    projectIdentity: projectIdentity.optional(),
    definition: z.unknown()
  })
  .strict()
export const templateCloneParams = z
  .object({
    ...mutationBase,
    sourceTemplateId: id,
    name: z.string().trim().min(1).max(160),
    scope: templateScope,
    sourceProjectIdentity: projectIdentity.optional(),
    projectIdentity: projectIdentity.optional()
  })
  .strict()
export const templateArchiveParams = z
  .object({
    ...mutationBase,
    templateId: id,
    projectIdentity: projectIdentity.optional()
  })
  .strict()
export const runCreateParams = z
  .object({
    ...mutationBase,
    templateId: id,
    projectIdentity,
    workspace: z.object({ kind: z.enum(['git-worktree', 'folder-workspace']), id }).strict(),
    executionHostId: id
  })
  .strict()

const policyOverridesSchema = z
  .object({
    policyVersion: z.literal('v1-review-rounds'),
    maxReviewRoundsByNodeId: z.record(z.string(), z.number().int().min(1).max(20))
  })
  .strict()

const promptOverrideEntrySchema = z
  .object({
    firstVisit: z.string().max(20_000).optional(),
    repeatVisit: z.string().max(20_000).optional()
  })
  .strict()

export const runCreateRerunParams = z
  .object({
    ...mutationBase,
    parentRunId: id,
    rerunReason: z.string().trim().max(4_000).nullable().optional(),
    noAdditionalRequirements: z.boolean().optional(),
    objective: z.string().trim().max(20_000).optional(),
    policyOverrides: policyOverridesSchema.nullable().optional(),
    promptOverrides: z.record(z.string(), promptOverrideEntrySchema).nullable().optional(),
    copyAssignments: z.boolean().optional()
  })
  .strict()

const assignmentSchema = z
  .object({
    worktreeId: id,
    executionHostId: id,
    paneKey: id,
    agentLifecycleId: id,
    providerSessionId: id.nullable(),
    runtimeAgent: id.nullable()
  })
  .strict()
export const runAssignParams = z
  .object({
    ...mutationBase,
    runId: id,
    nodeId: id,
    slotId: id,
    assignment: assignmentSchema.nullable(),
    removeAgentLifecycleId: id.optional()
  })
  .strict()
  .superRefine((params, context) => {
    if (params.assignment && params.removeAgentLifecycleId) {
      context.addIssue({
        code: 'custom',
        message: 'removeAgentLifecycleId is valid only when assignment is null.'
      })
    }
  })
export const runShowParams = z.object({ runId: id }).strict()
export const runListParams = z
  .object({
    projectIdentity: projectIdentity.optional(),
    workspace: z
      .object({ kind: z.enum(['git-worktree', 'folder-workspace']), id })
      .strict()
      .optional(),
    templateId: id.optional(),
    statuses: z
      .array(
        z.enum([
          'draft',
          'ready',
          'running',
          'paused',
          'waiting-human',
          'review-limit-reached',
          'cancelled',
          'completed',
          'failed'
        ])
      )
      .max(9)
      .optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional()
  })
  .strict()
export const runExportParams = z
  .object({ runId: id, format: z.enum(['markdown', 'json']) })
  .strict()
export const runUpdateParams = z
  .object({ ...mutationBase, runId: id, objective: z.string().max(100_000) })
  .strict()
export const runSwitchTemplateParams = z
  .object({
    ...mutationBase,
    runId: id,
    templateId: id,
    expectedVersion: z.number().int().min(1)
  })
  .strict()
export const runPrepareParams = z.object({ ...mutationBase, runId: id }).strict()
export const runStartParams = z.object({ ...mutationBase, runId: id }).strict()
export const runEventsParams = z.object({ runId: id }).strict()
