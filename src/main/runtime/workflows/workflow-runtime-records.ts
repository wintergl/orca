import { createHash, randomBytes } from 'node:crypto'
import type {
  WorkflowAgentAssignment,
  WorkflowArtifactManifestV1,
  WorkflowArtifactRevision,
  WorkflowEventType,
  WorkflowDecisionRecord,
  WorkflowMessageSource,
  WorkflowReviewAggregate,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { exposeTimestamp } from './workflow-store-records'

export type WorkflowStepRow = {
  id: string
  run_id: string
  node_id: string
  node_name: string
  node_type: WorkflowStepRunRecord['nodeType']
  round: number
  attempt: number
  status: WorkflowStepRunRecord['status']
  assignment_json: string | null
  orchestration_run_id: string | null
  task_id: string | null
  dispatch_id: string | null
  delivery_id: string
  delivery_state: WorkflowStepRunRecord['deliveryState']
  prompt: string
  conclusion_markdown: string | null
  result_envelope_json: string | null
  message_source: WorkflowMessageSource | null
  message_digest: string | null
  source_identity: string | null
  source_warnings_json: string
  input_artifact_revision_id: string | null
  output_artifact_revision_id: string | null
  review_guard_digest: string | null
  error_code: string | null
  error_message: string | null
  recovery: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type WorkflowArtifactRow = {
  id: string
  kind: WorkflowArtifactRevision['kind']
  revision: number
  execution_host_id: string
  worktree_id: string
  locator_json: string
  digest: string
  manifest_digest: string
  manifest_json: string
  snapshot_state: WorkflowArtifactRevision['snapshotState']
  produced_by_step_run_id: string
  materialized_path: string | null
  created_at: string
}

export type WorkflowEventRow = {
  id: string
  run_id: string
  sequence: number | null
  type: WorkflowEventType
  step_run_id: string | null
  payload_json: string
  created_at: string
}

export type WorkflowReviewAggregateRow = {
  id: string
  review_node_id: string
  round: number
  artifact_revision_id: string
  reviewer_step_run_ids_json: string
  outcome: WorkflowReviewAggregate['outcome']
  conflicts_json: string
  waiting_reason: WorkflowReviewAggregate['waitingReason']
  content: string
  created_at: string
}

export type WorkflowDecisionRow = {
  id: string
  run_id: string
  step_run_id: string
  review_aggregate_id: string
  rule_version: string
  deterministic_decision: WorkflowDecisionRecord['deterministicDecision']
  final_decision: WorkflowDecisionRecord['finalDecision']
  source: WorkflowDecisionRecord['source']
  input_json: string
  created_at: string
}

export function toWorkflowStep(row: WorkflowStepRow): WorkflowStepRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    nodeName: row.node_name,
    nodeType: row.node_type,
    round: row.round,
    attempt: row.attempt,
    status: row.status,
    assignment: row.assignment_json
      ? (JSON.parse(row.assignment_json) as WorkflowAgentAssignment)
      : null,
    orchestrationRunId: row.orchestration_run_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    deliveryId: row.delivery_id,
    deliveryState: row.delivery_state,
    prompt: row.prompt,
    conclusionMarkdown: row.conclusion_markdown,
    resultEnvelope: row.result_envelope_json ? JSON.parse(row.result_envelope_json) : null,
    messageSource: row.message_source,
    messageDigest: row.message_digest,
    sourceIdentity: row.source_identity,
    sourceWarnings: JSON.parse(row.source_warnings_json) as string[],
    inputArtifactRevisionId: row.input_artifact_revision_id,
    outputArtifactRevisionId: row.output_artifact_revision_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    recovery: row.recovery,
    startedAt: exposeTimestamp(row.started_at),
    completedAt: exposeTimestamp(row.completed_at),
    createdAt: exposeTimestamp(row.created_at)!,
    updatedAt: exposeTimestamp(row.updated_at)!
  }
}

export function toWorkflowArtifact(row: WorkflowArtifactRow): WorkflowArtifactRevision {
  return {
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    executionHostId: row.execution_host_id,
    worktreeId: row.worktree_id,
    locator: JSON.parse(row.locator_json) as Record<string, unknown>,
    digest: row.digest,
    manifestDigest: row.manifest_digest,
    manifest: JSON.parse(row.manifest_json) as WorkflowArtifactManifestV1,
    snapshotState: row.snapshot_state,
    producedByStepRunId: row.produced_by_step_run_id,
    materializedPath: row.materialized_path,
    createdAt: exposeTimestamp(row.created_at)!
  }
}

export function toWorkflowReviewAggregate(
  row: WorkflowReviewAggregateRow
): WorkflowReviewAggregate {
  return {
    schema: 'workflow.review-aggregate/v1',
    id: row.id,
    reviewNodeId: row.review_node_id,
    round: row.round,
    artifactRevisionId: row.artifact_revision_id,
    reviewerStepRunIds: JSON.parse(row.reviewer_step_run_ids_json) as string[],
    outcome: row.outcome,
    conflicts: JSON.parse(row.conflicts_json) as string[],
    waitingReason: row.waiting_reason,
    content: row.content,
    createdAt: exposeTimestamp(row.created_at)!
  }
}

export function toWorkflowDecision(row: WorkflowDecisionRow): WorkflowDecisionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    reviewAggregateId: row.review_aggregate_id,
    ruleVersion: row.rule_version,
    deterministicDecision: row.deterministic_decision,
    finalDecision: row.final_decision,
    source: row.source,
    input: JSON.parse(row.input_json),
    createdAt: exposeTimestamp(row.created_at)!
  }
}

export function workflowRecordId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('hex')}`
}

export function workflowDigest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
