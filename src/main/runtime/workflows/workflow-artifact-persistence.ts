import type Database from '../../sqlite/sync-database'
import type {
  WorkflowArtifactManifestV1,
  WorkflowArtifactRevision
} from '../../../shared/workflow-definition-types'
import { toWorkflowArtifact, workflowDigest, workflowRecordId } from './workflow-runtime-records'

export function saveWorkflowArtifact(
  db: Database.Database,
  params: {
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
  }
): WorkflowArtifactRevision {
  const existing = db
    .prepare(
      `SELECT * FROM workflow_artifact_revisions
       WHERE run_id = ? AND produced_by_step_run_id = ? AND digest = ?`
    )
    .get(params.runId, params.producedByStepRunId, params.digest) as
    | Parameters<typeof toWorkflowArtifact>[0]
    | undefined
  if (existing) {
    return toWorkflowArtifact(existing)
  }
  const revisionRow = db
    .prepare(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
       FROM workflow_artifact_revisions WHERE run_id = ? AND kind = ?`
    )
    .get(params.runId, params.kind) as { revision: number }
  const artifactId = workflowRecordId('workflow_artifact')
  const manifestJson = JSON.stringify(params.manifest)
  db.prepare(
    `INSERT INTO workflow_artifact_revisions (
       id, run_id, kind, revision, execution_host_id, worktree_id,
       locator_json, digest, manifest_digest, manifest_json, snapshot_state,
       produced_by_step_run_id, materialized_path
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    artifactId,
    params.runId,
    params.kind,
    revisionRow.revision,
    params.executionHostId,
    params.worktreeId,
    JSON.stringify(params.locator),
    params.digest,
    workflowDigest(manifestJson),
    manifestJson,
    params.snapshotState,
    params.producedByStepRunId,
    params.materializedPath
  )
  const row = db
    .prepare('SELECT * FROM workflow_artifact_revisions WHERE id = ?')
    .get(artifactId) as Parameters<typeof toWorkflowArtifact>[0]
  return toWorkflowArtifact(row)
}
