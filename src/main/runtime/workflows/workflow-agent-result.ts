import type {
  WorkflowCompletionSubmissionV1,
  WorkflowDecisionSubmissionV1,
  WorkflowReviewSubmissionV1
} from '../../../shared/workflow-result-schema'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import {
  parseWorkflowDecisionToken,
  parseWorkflowReviewVerdict
} from '../../../shared/workflow-decision-protocol'
import { WorkflowError } from './workflow-error'

type AutomaticWorkflowResult =
  | WorkflowCompletionSubmissionV1
  | WorkflowReviewSubmissionV1
  | WorkflowDecisionSubmissionV1

export function buildAutomaticWorkflowResult(
  step: WorkflowStepRunRecord,
  finalResponse: string
): AutomaticWorkflowResult {
  const conclusion = finalResponse.trim()
  if (!conclusion) {
    throw incomplete('The Agent returned an empty final response.')
  }
  if (step.nodeType === 'review') {
    try {
      return {
        schema: 'workflow.review-result/v1',
        verdict: parseWorkflowReviewVerdict(conclusion, { allowAliases: true }),
        issues: [],
        unverified: [],
        conclusionMarkdown: conclusion
      }
    } catch (error) {
      throw incomplete(error instanceof Error ? error.message : String(error))
    }
  }
  if (step.nodeType === 'decide') {
    try {
      return {
        schema: 'workflow.decision/v1',
        decision: parseWorkflowDecisionToken(conclusion, { allowAliases: true }),
        issues: [],
        conflicts: [],
        conclusionMarkdown: conclusion
      }
    } catch (error) {
      throw incomplete(error instanceof Error ? error.message : String(error))
    }
  }
  const failed = reportsFailure(conclusion)
  return {
    schema: 'workflow.completion/v1',
    outcome: failed ? 'failed' : 'succeeded',
    summary: summarize(conclusion),
    finalConclusionMarkdown: conclusion,
    artifacts: [],
    validations: [],
    unresolved: failed ? [summarize(conclusion)] : [],
    readyForNextStep: !failed
  }
}

function reportsFailure(value: string): boolean {
  const opening = value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.toLowerCase()
  return Boolean(opening && /^(failed|失败|未完成|无法完成|阻塞)\b/.test(opening))
}

function summarize(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`
}

function incomplete(message: string): WorkflowError {
  return new WorkflowError('workflow_completion_incomplete', message)
}
