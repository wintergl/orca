import type Database from '../../sqlite/sync-database'
import type {
  WorkflowAgentAssignment,
  WorkflowArtifactManifestV1,
  WorkflowArtifactRevision,
  WorkflowDecisionRecord,
  WorkflowEventType,
  WorkflowMessageSource,
  WorkflowNodeDefinitionV1,
  WorkflowRunEventsResult,
  WorkflowReviewAggregate,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { saveWorkflowArtifact } from './workflow-artifact-persistence'
import {
  toWorkflowArtifact,
  toWorkflowDecision,
  toWorkflowReviewAggregate,
  toWorkflowStep,
  workflowDigest,
  workflowRecordId,
  type WorkflowArtifactRow,
  type WorkflowDecisionRow,
  type WorkflowReviewAggregateRow,
  type WorkflowStepRow
} from './workflow-runtime-records'
import { insertWorkflowEvent, listWorkflowEvents } from './workflow-event-store'
import {
  acquireWorkflowRecoveryLease,
  claimWorkflowExternalReceipt,
  listRecoverableWorkflowRunOwners
} from './workflow-recovery-persistence'

export class WorkflowRuntimePersistence {
  constructor(public readonly db: Database.Database) {}

  saveArtifact(params: {
    runId: string
    kind: WorkflowArtifactRevision['kind']
    executionHostId: string
    worktreeId: string
    locator: Record<string, unknown>
    digest: string
    manifest: WorkflowArtifactManifestV1
    snapshotState: WorkflowArtifactRevision['snapshotState']
    producedByStepRunId: string
    materializedPath: string | null
  }): WorkflowArtifactRevision {
    return this.transaction(() => saveWorkflowArtifact(this.db, params))
  }

  putBlob(content: Buffer): { blobId: string; digest: string; size: number } {
    const digest = workflowDigest(content)
    const blobId = `sha256:${digest}`
    this.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_blobs (blob_id, digest, size, content)
         VALUES (?, ?, ?, ?)`
      )
      .run(blobId, digest, content.length, content)
    return { blobId, digest, size: content.length }
  }

  getBlob(blobId: string): Buffer | null {
    const row = this.db
      .prepare('SELECT content FROM workflow_blobs WHERE blob_id = ?')
      .get(blobId) as { content: Uint8Array } | undefined
    return row ? Buffer.from(row.content) : null
  }

  getBaseline(runId: string): unknown {
    const row = this.db
      .prepare('SELECT baseline_json FROM workflow_runs WHERE id = ?')
      .get(runId) as { baseline_json: string | null } | undefined
    return row?.baseline_json ? JSON.parse(row.baseline_json) : null
  }

  listRecoverableRunOwners(): { runId: string; ownerIdentity: string }[] {
    return listRecoverableWorkflowRunOwners(this.db)
  }

  acquireRecoveryLease(runId: string, ownerId: string): boolean {
    return acquireWorkflowRecoveryLease(this.db, runId, ownerId)
  }

  claimExternalReceipt(params: {
    runId: string
    stepRunId: string
    messageId: string
    kind: string
  }): boolean {
    return claimWorkflowExternalReceipt(this.db, params)
  }

  listSteps(runId: string): WorkflowStepRunRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY rowid')
        .all(runId) as WorkflowStepRow[]
    ).map(toWorkflowStep)
  }

  getStep(stepRunId: string): WorkflowStepRunRecord | null {
    const row = this.db.prepare('SELECT * FROM workflow_step_runs WHERE id = ?').get(stepRunId) as
      | WorkflowStepRow
      | undefined
    return row ? toWorkflowStep(row) : null
  }

  findActiveRunOwnerByDispatch(params: {
    taskId: string
    dispatchId: string
  }): { runId: string; ownerIdentity: string; stepRunId: string } | null {
    const row = this.db
      .prepare(
        `SELECT runs.id AS runId, runs.owner_identity AS ownerIdentity,
                steps.id AS stepRunId
         FROM workflow_step_runs AS steps
         JOIN workflow_runs AS runs ON runs.id = steps.run_id
         WHERE steps.task_id = ? AND steps.dispatch_id = ?
           AND steps.status IN ('delivering', 'running')
           AND runs.status IN ('running', 'paused')
         ORDER BY steps.rowid DESC LIMIT 1`
      )
      .get(params.taskId, params.dispatchId) as
      | { runId: string; ownerIdentity: string; stepRunId: string }
      | undefined
    return row ?? null
  }

  getStepReviewGuardDigest(stepRunId: string): string | null {
    const row = this.db
      .prepare('SELECT review_guard_digest FROM workflow_step_runs WHERE id = ?')
      .get(stepRunId) as { review_guard_digest: string | null } | undefined
    return row?.review_guard_digest ?? null
  }

  listArtifacts(runId: string): WorkflowArtifactRevision[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM workflow_artifact_revisions WHERE run_id = ? ORDER BY revision, rowid'
        )
        .all(runId) as WorkflowArtifactRow[]
    ).map(toWorkflowArtifact)
  }

  listReviewAggregates(runId: string): WorkflowReviewAggregate[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM workflow_review_aggregates
           WHERE run_id = ? ORDER BY round, created_at, rowid`
        )
        .all(runId) as WorkflowReviewAggregateRow[]
    ).map(toWorkflowReviewAggregate)
  }

  listDecisions(runId: string): WorkflowDecisionRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM workflow_decisions WHERE run_id = ? ORDER BY created_at, rowid')
        .all(runId) as WorkflowDecisionRow[]
    ).map(toWorkflowDecision)
  }

  getArtifact(artifactId: string): WorkflowArtifactRevision | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_artifact_revisions WHERE id = ?')
      .get(artifactId) as WorkflowArtifactRow | undefined
    return row ? toWorkflowArtifact(row) : null
  }

  events(runId: string): WorkflowRunEventsResult {
    return listWorkflowEvents(this.db, runId)
  }

  insertStep(
    runId: string,
    node: WorkflowNodeDefinitionV1,
    assignment: WorkflowAgentAssignment | null,
    inputArtifactRevisionId: string | null,
    status: WorkflowStepRunRecord['status'] = 'queued',
    round = 1,
    attempt = 1
  ): WorkflowStepRunRecord {
    const stepId = workflowRecordId('workflow_step')
    this.db
      .prepare(
        `INSERT INTO workflow_step_runs (
           id, run_id, node_id, node_name, node_type, round, attempt,
           assignment_json, assignment_key, delivery_id, input_artifact_revision_id, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stepId,
        runId,
        node.id,
        node.name,
        node.type,
        round,
        attempt,
        assignment ? JSON.stringify(assignment) : null,
        assignment ? `${assignment.slotId}:${assignment.agentLifecycleId}` : 'engine',
        workflowRecordId('workflow_delivery'),
        inputArtifactRevisionId,
        status
      )
    return this.getStep(stepId)!
  }

  finishEngineStep(stepRunId: string, envelope: unknown, conclusionMarkdown: string): void {
    this.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
             delivery_state = CASE WHEN delivery_state = 'prepared' THEN 'delivered'
               ELSE delivery_state END,
             started_at = COALESCE(started_at, datetime('now')),
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
  }

  finishStep(params: {
    stepRunId: string
    envelope: unknown
    conclusionMarkdown: string
    source: WorkflowMessageSource
    digest: string
    sourceIdentity: string | null
    warnings: string[]
    outputArtifactRevisionId?: string
  }): void {
    this.db
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
             delivery_state = 'delivered',
             message_source = ?, message_digest = ?, source_identity = ?,
             source_warnings_json = ?, output_artifact_revision_id = COALESCE(?, output_artifact_revision_id),
             error_code = NULL, error_message = NULL, recovery = NULL,
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        params.conclusionMarkdown,
        JSON.stringify(params.envelope),
        params.source,
        params.digest,
        params.sourceIdentity,
        JSON.stringify(params.warnings),
        params.outputArtifactRevisionId ?? null,
        params.stepRunId
      )
  }

  insertResultMessage(params: {
    runId: string
    stepRunId: string
    kind: 'completion' | 'review-result'
    content: unknown
    markdown: string
    source: WorkflowMessageSource
    digest: string
    sourceIdentity: string | null
    sourceReference: unknown
  }): void {
    this.db
      .prepare(
        `INSERT INTO workflow_messages (
           id, run_id, step_run_id, kind, content_json, markdown, source,
           digest, source_identity, source_reference_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workflowRecordId('workflow_message'),
        params.runId,
        params.stepRunId,
        params.kind,
        JSON.stringify(params.content),
        params.markdown,
        params.source,
        params.digest,
        params.sourceIdentity,
        JSON.stringify(params.sourceReference)
      )
  }

  insertEvent(
    runId: string,
    type: WorkflowEventType,
    stepRunId: string | null,
    payload: unknown
  ): void {
    insertWorkflowEvent(this.db, runId, type, stepRunId, payload)
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
