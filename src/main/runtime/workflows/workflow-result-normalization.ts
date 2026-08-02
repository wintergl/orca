import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  WorkflowCompletionEnvelopeV1Schema,
  WorkflowCompletionSubmissionV1Schema,
  WorkflowDecisionSubmissionV1Schema,
  WorkflowDecisionV1Schema,
  WorkflowReviewResultV1Schema,
  WorkflowReviewSubmissionV1Schema,
  type WorkflowCompletionEnvelopeV1,
  type WorkflowDecisionV1,
  type WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import { workflowIncompleteWithRawAgentText } from './workflow-attempt-raw-response'
import { WorkflowError } from './workflow-error'
import { assertWorkflowResultIdentity } from './workflow-result-identity'

type WorkflowResult = WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1

export function normalizeWorkflowResult(
  value: unknown,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): WorkflowResult {
  const fullSchema =
    step.nodeType === 'review'
      ? WorkflowReviewResultV1Schema
      : step.nodeType === 'decide'
        ? WorkflowDecisionV1Schema
        : WorkflowCompletionEnvelopeV1Schema
  const full = fullSchema.safeParse(value)
  if (full.success) {
    assertWorkflowResultIdentity(full.data, run, step)
    assertInputIdentity(full.data, run, step)
    return full.data
  }

  const compact =
    step.nodeType === 'review'
      ? WorkflowReviewSubmissionV1Schema.safeParse(value)
      : step.nodeType === 'decide'
        ? WorkflowDecisionSubmissionV1Schema.safeParse(value)
        : WorkflowCompletionSubmissionV1Schema.safeParse(value)
  if (!compact.success) {
    throw incomplete(
      'The Workflow result JSON does not match its required schema.',
      compact.error,
      rawAgentTextFromValue(value)
    )
  }

  const identity = {
    taskId: required(step.taskId, 'Task'),
    dispatchId: required(step.dispatchId, 'Dispatch'),
    workflowRunId: run.id,
    stepRunId: step.id,
    agentLifecycleId: required(step.assignment?.agentLifecycleId, 'Agent lifecycle'),
    providerSessionId: step.assignment?.providerSessionId ?? null,
    executionHostId: run.executionHostId
  }
  const expanded =
    step.nodeType === 'review'
      ? {
          ...compact.data,
          ...identity,
          artifactRevisionId: required(step.inputArtifactRevisionId, 'Artifact Revision')
        }
      : step.nodeType === 'decide'
        ? {
            ...compact.data,
            ...identity,
            reviewAggregateId: required(reviewAggregateId(run, step), 'Review Aggregate')
          }
        : { ...compact.data, ...identity }
  const parsed = fullSchema.safeParse(expanded)
  if (!parsed.success) {
    throw incomplete('The expanded Workflow result is invalid.', parsed.error)
  }
  assertWorkflowResultIdentity(parsed.data, run, step)
  assertInputIdentity(parsed.data, run, step)
  return parsed.data
}

function assertInputIdentity(
  value: WorkflowResult,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): void {
  if (
    value.schema === 'workflow.review-result/v1' &&
    value.artifactRevisionId !== step.inputArtifactRevisionId
  ) {
    throw incomplete('The Review result references a different Artifact Revision.')
  }
  if (
    value.schema === 'workflow.decision/v1' &&
    value.reviewAggregateId !== reviewAggregateId(run, step)
  ) {
    throw incomplete('The Decision result references a different Review Aggregate.')
  }
}

function reviewAggregateId(run: WorkflowRunRecord, step: WorkflowStepRunRecord): string | null {
  return (
    run.reviewAggregates
      .toReversed()
      .find((aggregate) => aggregate.artifactRevisionId === step.inputArtifactRevisionId)?.id ??
    null
  )
}

function required(value: string | null | undefined, label: string): string {
  if (!value) {
    throw incomplete(`${label} identity is unavailable.`)
  }
  return value
}

function rawAgentTextFromValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of ['conclusionMarkdown', 'finalConclusionMarkdown'] as const) {
    const text = record[key]
    if (typeof text === 'string' && text.trim()) {
      return text
    }
  }
  return undefined
}

function incomplete(message: string, _cause?: unknown, rawAgentText?: string): WorkflowError {
  if (rawAgentText?.trim()) {
    // Why: never attach parse/schema cause objects — messages can embed raw fragments.
    return workflowIncompleteWithRawAgentText(message, rawAgentText)
  }
  return new WorkflowError('workflow_completion_incomplete', message)
}
