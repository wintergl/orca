import { describe, expect, it } from 'vitest'
import type { WorkflowReviewResultV1 } from '../../../shared/workflow-result-schema'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { buildWorkflowReviewAggregate, type CompletedReviewer } from './workflow-review-aggregate'

describe('Workflow Review Aggregate', () => {
  it('uses slot order and Step Run ID instead of completion order', () => {
    const run = runRecord()
    const reviewerA = reviewer('step-z', 'reviewer-a', 'slot-a', 'approve')
    const reviewerB = reviewer('step-a', 'reviewer-b', 'slot-b', 'approve')

    const first = aggregate(run, [reviewerB, reviewerA])
    const second = aggregate(run, [reviewerA, reviewerB])

    expect(first.reviewerStepRunIds).toEqual(['step-z', 'step-a'])
    expect(second.reviewerStepRunIds).toEqual(first.reviewerStepRunIds)
    expect(second.content).toBe(first.content)
    expect(first.outcome).toBe('approve')
  })

  it('never lets approve votes override revise, request-human, or blockers', () => {
    const run = runRecord()
    const approve = reviewer('step-a', 'reviewer-a', 'slot-a', 'approve')
    const revise = reviewer('step-b', 'reviewer-b', 'slot-b', 'revise')
    const requestHuman = reviewer('step-c', 'reviewer-c', 'slot-b', 'request-human')

    expect(aggregate(run, [approve, revise]).outcome).toBe('revise')
    expect(aggregate(run, [approve, revise]).waitingReason).toBe('review-revision-required')
    const human = aggregate(run, [approve, revise, requestHuman])
    expect(human.outcome).toBe('request-human')
    expect(human.waitingReason).toBe('review-conflict')

    approve.result.issues.push({
      id: 'blocker',
      severity: 'blocker',
      location: 'src/result.ts',
      evidence: 'Unsafe behavior',
      recommendation: 'Fix it'
    })
    expect(aggregate(run, [approve]).outcome).toBe('revise')
  })
})

function aggregate(run: WorkflowRunRecord, reviewers: CompletedReviewer[]) {
  return buildWorkflowReviewAggregate({
    id: 'aggregate-1',
    run,
    reviewNodeId: 'review',
    round: 1,
    artifactRevisionId: 'artifact-1',
    reviewers,
    createdAt: '2026-07-29T00:00:00.000Z'
  })
}

function reviewer(
  id: string,
  lifecycleId: string,
  slotId: string,
  verdict: WorkflowReviewResultV1['verdict']
): CompletedReviewer {
  return {
    step: {
      id,
      assignment: { agentLifecycleId: lifecycleId, slotId }
    } as WorkflowStepRunRecord,
    result: {
      schema: 'workflow.review-result/v1',
      taskId: `task-${id}`,
      dispatchId: `dispatch-${id}`,
      workflowRunId: 'run-1',
      stepRunId: id,
      agentLifecycleId: lifecycleId,
      providerSessionId: `session-${id}`,
      executionHostId: 'local',
      artifactRevisionId: 'artifact-1',
      verdict,
      issues: [],
      unverified: [],
      conclusionMarkdown: `${lifecycleId} conclusion`
    }
  }
}

function runRecord(): WorkflowRunRecord {
  return {
    templateSnapshot: {
      roleSlots: [{ id: 'slot-a' }, { id: 'slot-b' }]
    }
  } as WorkflowRunRecord
}
