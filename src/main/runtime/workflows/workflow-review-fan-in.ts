import type {
  WorkflowMessageSource,
  WorkflowReviewAggregate,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  WorkflowReviewResultV1Schema,
  type WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import { buildWorkflowReviewAggregate } from './workflow-review-aggregate'
import { workflowRecordId } from './workflow-runtime-records'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import { advanceReviewAggregate } from './workflow-transition-engine'
import { claimWorkflowResultReceipt } from './workflow-result-receipt'

export type WorkflowReviewCompletion = {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  result: WorkflowReviewResultV1
  conclusionMarkdown: string
  source: WorkflowMessageSource
  digest: string
  sourceIdentity: string | null
  sourceReference: unknown
  warnings: string[]
  verdict: 'approve' | 'revise' | 'request-human'
}

export function completeWorkflowReview(
  store: WorkflowRuntimePersistence,
  params: WorkflowReviewCompletion
): WorkflowReviewAggregate | null {
  return store.transaction(() => completeWorkflowReviewInTransaction(store, params))
}

/** Caller must hold the Workflow DB transaction. */
export function completeWorkflowReviewInTransaction(
  store: WorkflowRuntimePersistence,
  params: WorkflowReviewCompletion
): WorkflowReviewAggregate | null {
  const persisted = store.getStep(params.step.id)
  if (persisted?.status === 'succeeded') {
    return aggregateFor(store, params.run.id, params.step)
  }
  claimWorkflowResultReceipt(
    store,
    params.run.id,
    params.step.id,
    'review-result',
    params.sourceReference
  )
  store.insertResultMessage({
    runId: params.run.id,
    stepRunId: params.step.id,
    kind: 'review-result',
    content: params.result,
    markdown: params.conclusionMarkdown,
    source: params.source,
    digest: params.digest,
    sourceIdentity: params.sourceIdentity,
    sourceReference: params.sourceReference
  })
  store.finishStep({
    stepRunId: params.step.id,
    envelope: params.result,
    conclusionMarkdown: params.conclusionMarkdown,
    source: params.source,
    digest: params.digest,
    sourceIdentity: params.sourceIdentity,
    warnings: params.warnings
  })
  store.insertEvent(params.run.id, 'review-collected', params.step.id, {
    nodeId: params.step.nodeId,
    verdict: params.verdict,
    artifactRevisionId: params.step.inputArtifactRevisionId
  })
  store.insertEvent(params.run.id, 'step-completed', params.step.id, {
    nodeId: params.step.nodeId,
    verdict: params.verdict
  })
  return createAggregateWhenReady(store, params)
}

function createAggregateWhenReady(
  store: WorkflowRuntimePersistence,
  params: WorkflowReviewCompletion
): WorkflowReviewAggregate | null {
  const existing = aggregateFor(store, params.run.id, params.step)
  if (existing) {
    return existing
  }
  const expected = params.run.assignments.filter(
    (assignment) => assignment.nodeId === params.step.nodeId
  )
  const latest = latestReviewerSteps(
    store
      .listSteps(params.run.id)
      .filter(
        (step) =>
          step.nodeId === params.step.nodeId &&
          step.round === params.step.round &&
          step.inputArtifactRevisionId === params.step.inputArtifactRevisionId
      )
  )
  if (
    expected.length === 0 ||
    expected.some((assignment) => latest.get(assignment.agentLifecycleId)?.status !== 'succeeded')
  ) {
    store.insertEvent(params.run.id, 'review-waiting', params.step.id, {
      completed: [...latest.values()].filter((step) => step.status === 'succeeded').length,
      total: expected.length
    })
    return null
  }
  const reviewers = expected.map((assignment) => {
    const step = latest.get(assignment.agentLifecycleId)!
    return { step, result: WorkflowReviewResultV1Schema.parse(step.resultEnvelope) }
  })
  const aggregate = buildWorkflowReviewAggregate({
    id: workflowRecordId('workflow_review_aggregate'),
    run: params.run,
    reviewNodeId: params.step.nodeId,
    round: params.step.round,
    artifactRevisionId: params.step.inputArtifactRevisionId!,
    reviewers,
    createdAt: new Date().toISOString()
  })
  store.db
    .prepare(
      `INSERT INTO workflow_review_aggregates (
         id, run_id, review_node_id, round, artifact_revision_id,
         reviewer_step_run_ids_json, outcome, conflicts_json, waiting_reason, content
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      aggregate.id,
      params.run.id,
      aggregate.reviewNodeId,
      aggregate.round,
      aggregate.artifactRevisionId,
      JSON.stringify(aggregate.reviewerStepRunIds),
      aggregate.outcome,
      JSON.stringify(aggregate.conflicts),
      aggregate.waitingReason,
      aggregate.content
    )
  store.insertEvent(params.run.id, 'review-aggregate-created', params.step.id, {
    aggregateId: aggregate.id,
    outcome: aggregate.outcome,
    waitingReason: aggregate.waitingReason
  })
  if (params.run.status === 'running') {
    advanceReviewAggregate(store, params.run, aggregate)
  }
  return aggregateFor(store, params.run.id, params.step)
}

function latestReviewerSteps(steps: WorkflowStepRunRecord[]): Map<string, WorkflowStepRunRecord> {
  const latest = new Map<string, WorkflowStepRunRecord>()
  for (const step of steps) {
    const lifecycleId = step.assignment?.agentLifecycleId
    if (lifecycleId && (latest.get(lifecycleId)?.attempt ?? 0) <= step.attempt) {
      latest.set(lifecycleId, step)
    }
  }
  return latest
}

function aggregateFor(
  store: WorkflowRuntimePersistence,
  runId: string,
  step: WorkflowStepRunRecord
): WorkflowReviewAggregate | null {
  return (
    store
      .listReviewAggregates(runId)
      .find(
        (aggregate) =>
          aggregate.reviewNodeId === step.nodeId &&
          aggregate.round === step.round &&
          aggregate.artifactRevisionId === step.inputArtifactRevisionId
      ) ?? null
  )
}
