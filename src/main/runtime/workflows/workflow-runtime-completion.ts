import type {
  WorkflowArtifactRevision,
  WorkflowMessageSource,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowDecisionV1 } from '../../../shared/workflow-result-schema'
import {
  completeWorkflowReview,
  completeWorkflowReviewInTransaction,
  type WorkflowReviewCompletion
} from './workflow-review-fan-in'
import { claimWorkflowResultReceipt } from './workflow-result-receipt'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import {
  advanceProduceTransition,
  applyPersistedDecision,
  finishAgentDecision
} from './workflow-transition-engine'

export type ProduceCompletionParams = {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  envelope: unknown
  conclusionMarkdown: string
  source: WorkflowMessageSource
  digest: string
  sourceIdentity: string | null
  sourceReference: unknown
  warnings: string[]
  artifact: WorkflowArtifactRevision
  advance?: boolean
}

export type DecisionCompletionCollected = {
  result: WorkflowDecisionV1
  source: WorkflowMessageSource
  digest: string
  sourceIdentity: string | null
  sourceReference: unknown
  warnings: string[]
}

export function completeProduce(
  store: WorkflowRuntimePersistence,
  params: ProduceCompletionParams
): WorkflowStepRunRecord[] {
  return store.transaction(() => completeProduceInTransaction(store, params))
}

export function completeProduceInTransaction(
  store: WorkflowRuntimePersistence,
  params: ProduceCompletionParams
): WorkflowStepRunRecord[] {
  const persisted = store.getStep(params.step.id)
  if (persisted?.status === 'succeeded') {
    return []
  }
  claimWorkflowResultReceipt(
    store,
    params.run.id,
    params.step.id,
    'completion',
    params.sourceReference
  )
  store.insertResultMessage({
    runId: params.run.id,
    stepRunId: params.step.id,
    kind: 'completion',
    content: params.envelope,
    markdown: params.conclusionMarkdown,
    source: params.source,
    digest: params.digest,
    sourceIdentity: params.sourceIdentity,
    sourceReference: params.sourceReference
  })
  store.finishStep({
    stepRunId: params.step.id,
    envelope: params.envelope,
    conclusionMarkdown: params.conclusionMarkdown,
    source: params.source,
    digest: params.digest,
    sourceIdentity: params.sourceIdentity,
    warnings: params.warnings,
    outputArtifactRevisionId: params.artifact.id
  })
  store.insertEvent(params.run.id, 'step-completed', params.step.id, {
    nodeId: params.step.nodeId,
    artifactRevisionId: params.artifact.id
  })
  if (params.advance === false) {
    return []
  }
  return advanceProduceTransition(store, params.run, params.step, params.artifact)
}

export function completeReview(
  store: WorkflowRuntimePersistence,
  params: WorkflowReviewCompletion
) {
  return completeWorkflowReview(store, params)
}

export function completeReviewInTransaction(
  store: WorkflowRuntimePersistence,
  params: WorkflowReviewCompletion
) {
  return completeWorkflowReviewInTransaction(store, params)
}

export function completeDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  aggregate: WorkflowRunRecord['reviewAggregates'][number],
  collected: DecisionCompletionCollected,
  apply = true
): void {
  store.transaction(() =>
    completeDecisionInTransaction(store, run, step, aggregate, collected, apply)
  )
}

export function completeDecisionInTransaction(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  aggregate: WorkflowRunRecord['reviewAggregates'][number],
  collected: DecisionCompletionCollected,
  apply = true
): void {
  if (store.getStep(step.id)?.status === 'succeeded') {
    return
  }
  claimWorkflowResultReceipt(store, run.id, step.id, 'decision', collected.sourceReference)
  finishAgentDecision(store, run, step, aggregate, collected, apply)
}

export function advancePersistedDecision(
  store: WorkflowRuntimePersistence,
  run: WorkflowRunRecord,
  decision: WorkflowRunRecord['decisions'][number]
): void {
  store.transaction(() => applyPersistedDecision(store, run, decision))
}
