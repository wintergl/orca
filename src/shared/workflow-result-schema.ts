import { z } from 'zod'

const identityFields = {
  taskId: z.string().trim().min(1),
  dispatchId: z.string().trim().min(1),
  workflowRunId: z.string().trim().min(1),
  stepRunId: z.string().trim().min(1),
  agentLifecycleId: z.string().trim().min(1),
  providerSessionId: z.string().trim().min(1).nullable(),
  executionHostId: z.string().trim().min(1)
}

const identityFieldMask = {
  taskId: true,
  dispatchId: true,
  workflowRunId: true,
  stepRunId: true,
  agentLifecycleId: true,
  providerSessionId: true,
  executionHostId: true
} as const

export const WorkflowCompletionEnvelopeV1Schema = z
  .object({
    schema: z.literal('workflow.completion/v1'),
    ...identityFields,
    outcome: z.enum(['succeeded', 'failed']),
    summary: z.string().trim().min(1).max(20_000),
    finalConclusionMarkdown: z.string().trim().min(1).max(4_000_000),
    artifacts: z
      .array(
        z
          .object({
            kind: z.enum(['spec', 'code', 'review-report', 'test-report']),
            locator: z.record(z.string(), z.unknown())
          })
          .strict()
      )
      .max(1_000),
    validations: z
      .array(
        z
          .object({
            command: z.string().max(20_000),
            result: z.enum(['passed', 'failed', 'not-run']),
            evidence: z.string().max(100_000)
          })
          .strict()
      )
      .max(1_000),
    unresolved: z.array(z.string().max(100_000)).max(1_000),
    readyForNextStep: z.boolean()
  })
  .strict()

export const WorkflowCompletionSubmissionV1Schema =
  WorkflowCompletionEnvelopeV1Schema.omit(identityFieldMask)

export const WorkflowReviewResultV1Schema = z
  .object({
    schema: z.literal('workflow.review-result/v1'),
    ...identityFields,
    artifactRevisionId: z.string().trim().min(1),
    verdict: z.enum(['approve', 'revise', 'request-human']),
    issues: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(500),
            severity: z.enum(['blocker', 'major', 'minor', 'suggestion']),
            location: z.string().max(100_000),
            evidence: z.string().max(200_000),
            recommendation: z.string().max(200_000)
          })
          .strict()
      )
      .max(10_000),
    unverified: z.array(z.string().max(100_000)).max(1_000),
    conclusionMarkdown: z.string().trim().min(1).max(4_000_000)
  })
  .strict()

export const WorkflowReviewSubmissionV1Schema = WorkflowReviewResultV1Schema.omit({
  ...identityFieldMask,
  artifactRevisionId: true
})

export const WorkflowDecisionV1Schema = z
  .object({
    schema: z.literal('workflow.decision/v1'),
    ...identityFields,
    reviewAggregateId: z.string().trim().min(1),
    decision: z.enum(['approve', 'revise', 'request-human', 'stop-at-review']),
    issues: z.array(z.string().trim().min(1).max(200_000)).max(10_000),
    conflicts: z.array(z.string().trim().min(1).max(200_000)).max(10_000),
    conclusionMarkdown: z.string().trim().min(1).max(4_000_000)
  })
  .strict()

export const WorkflowDecisionSubmissionV1Schema = WorkflowDecisionV1Schema.omit({
  ...identityFieldMask,
  reviewAggregateId: true
})

export type WorkflowCompletionEnvelopeV1 = z.infer<typeof WorkflowCompletionEnvelopeV1Schema>
export type WorkflowCompletionSubmissionV1 = z.infer<typeof WorkflowCompletionSubmissionV1Schema>
export type WorkflowReviewResultV1 = z.infer<typeof WorkflowReviewResultV1Schema>
export type WorkflowReviewSubmissionV1 = z.infer<typeof WorkflowReviewSubmissionV1Schema>
export type WorkflowDecisionV1 = z.infer<typeof WorkflowDecisionV1Schema>
export type WorkflowDecisionSubmissionV1 = z.infer<typeof WorkflowDecisionSubmissionV1Schema>
