import type {
  WorkflowCompletionSubmissionV1,
  WorkflowDecisionSubmissionV1,
  WorkflowReviewSubmissionV1
} from '../../../shared/workflow-result-schema'
import type {
  WorkflowDefinitionV1,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  parseWorkflowDecisionToken,
  parseWorkflowReviewVerdict,
  workflowDecisionAllowsAliases
} from '../../../shared/workflow-decision-protocol'
import { workflowIncompleteWithRawAgentText } from './workflow-attempt-raw-response'

type AutomaticWorkflowResult =
  | WorkflowCompletionSubmissionV1
  | WorkflowReviewSubmissionV1
  | WorkflowDecisionSubmissionV1

export function buildAutomaticWorkflowResult(
  step: WorkflowStepRunRecord,
  finalResponse: string,
  options?: { decisionProtocolVersion?: WorkflowDefinitionV1['decisionProtocolVersion'] }
): AutomaticWorkflowResult {
  const conclusion = finalResponse.trim()
  if (!conclusion) {
    throw incomplete('The Agent returned an empty final response.', conclusion)
  }
  const allowAliases = workflowDecisionAllowsAliases(options?.decisionProtocolVersion)
  if (step.nodeType === 'review') {
    try {
      return {
        schema: 'workflow.review-result/v1',
        verdict: parseWorkflowReviewVerdict(conclusion, { allowAliases }),
        issues: [],
        unverified: [],
        conclusionMarkdown: conclusion
      }
    } catch (error) {
      throw incomplete(error instanceof Error ? error.message : String(error), conclusion)
    }
  }
  if (step.nodeType === 'decide') {
    try {
      return {
        schema: 'workflow.decision/v1',
        decision: parseWorkflowDecisionToken(conclusion, { allowAliases }),
        issues: [],
        conflicts: [],
        conclusionMarkdown: conclusion
      }
    } catch (error) {
      throw incomplete(error instanceof Error ? error.message : String(error), conclusion)
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

function incomplete(message: string, rawAgentText?: string) {
  return workflowIncompleteWithRawAgentText(message, rawAgentText ?? '')
}
