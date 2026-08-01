export type WorkflowArtifactManifestEntryV1 = {
  path: string
  kind: 'file' | 'git-diff' | 'deleted'
  size: number
  digest: string
  blobId: string
}

export type WorkflowArtifactManifestV1 = {
  schema: 'workflow.artifact-manifest/v1'
  executionHostId: string
  workspaceId: string
  entries: WorkflowArtifactManifestEntryV1[]
}

export type WorkflowArtifactRevision = {
  id: string
  kind: 'spec' | 'code' | 'review-report' | 'test-report'
  revision: number
  executionHostId: string
  worktreeId: string
  locator: Record<string, unknown>
  digest: string
  manifestDigest: string
  manifest: WorkflowArtifactManifestV1
  snapshotState: 'frozen' | 'drifted' | 'unavailable'
  producedByStepRunId: string
  materializedPath: string | null
  createdAt: string
}
