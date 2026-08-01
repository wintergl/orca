import { createHash } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  WorkflowArtifactManifestEntryV1,
  WorkflowArtifactRevision,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowCompletionEnvelopeV1 } from '../../../shared/workflow-result-schema'
import type { WorkflowStore } from './workflow-store'
import {
  changedFolderPaths,
  gitArtifactSnapshot,
  readSnapshotFile,
  type WorkflowWorkspaceBaseline
} from './workflow-workspace-snapshot'
import { WorkflowError } from './workflow-error'

export async function freezeWorkflowArtifact(params: {
  store: WorkflowStore
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  envelope: WorkflowCompletionEnvelopeV1
  baseline: WorkflowWorkspaceBaseline
  workerFilesModified: string[]
}): Promise<WorkflowArtifactRevision> {
  const node = params.run.templateSnapshot.nodes.find(
    (candidate) => candidate.id === params.step.nodeId
  )
  if (!node || node.type !== 'produce') {
    throw new WorkflowError('workflow_artifact_unavailable', 'Produce node is unavailable.')
  }
  const entries: WorkflowArtifactManifestEntryV1[] = []
  const locator: Record<string, unknown> = {
    artifactKind: node.artifactKind,
    sourceLocators: params.envelope.artifacts.map((artifact) => artifact.locator)
  }
  if (node.artifactKind === 'spec') {
    const declaredPaths = collectArtifactPaths(params.envelope, params.workerFilesModified)
    const paths =
      declaredPaths.length > 0 ? declaredPaths : await changedArtifactPaths(params.baseline)
    if (paths.length === 0) {
      throw new WorkflowError(
        'workflow_artifact_unavailable',
        'SPEC completion did not identify a file to freeze.'
      )
    }
    for (const path of paths) {
      entries.push(await freezeFile(params.store, params.baseline.workspacePath, path))
    }
    locator.paths = paths
  } else if (params.baseline.kind === 'git-worktree') {
    const snapshot = await gitArtifactSnapshot(params.baseline)
    if (snapshot.diff.length === 0 && snapshot.paths.length === 0) {
      throw new WorkflowError(
        'workflow_artifact_unavailable',
        'Code completion produced no Git changes to freeze.'
      )
    }
    const diffBlob = params.store.putBlob(snapshot.diff)
    entries.push({
      path: 'git.diff',
      kind: 'git-diff',
      size: diffBlob.size,
      digest: diffBlob.digest,
      blobId: diffBlob.blobId
    })
    for (const path of snapshot.paths) {
      entries.push(
        snapshot.deletedPaths.includes(path)
          ? freezeDeletion(params.store, path)
          : await freezeFile(params.store, params.baseline.workspacePath, path)
      )
    }
    Object.assign(locator, {
      baseSha: snapshot.baseSha,
      headSha: snapshot.headSha,
      modifiedFiles: snapshot.paths,
      hasUncommittedChanges: snapshot.dirty
    })
  } else {
    const folderBaseline = params.baseline
    const changed = await changedFolderPaths(folderBaseline)
    const requested = collectArtifactPaths(params.envelope, params.workerFilesModified).filter(
      (path) => changed.currentFiles[path] !== undefined
    )
    const deletedPaths = new Set(changed.deletedPaths)
    const paths = [...new Set([...changed.paths, ...requested])]
      .filter((path) => !deletedPaths.has(path))
      .sort()
    if (paths.length === 0 && changed.deletedPaths.length === 0) {
      throw new WorkflowError(
        'workflow_artifact_unavailable',
        'Code completion produced no Folder Workspace changes to freeze.'
      )
    }
    for (const path of paths) {
      entries.push(await freezeFile(params.store, params.baseline.workspacePath, path))
    }
    for (const path of changed.deletedPaths) {
      entries.push(freezeDeletion(params.store, path))
    }
    Object.assign(locator, {
      files: paths,
      deletedFiles: changed.deletedPaths,
      fileMetadata: Object.fromEntries(
        paths.map((path) => [path, changed.currentFiles[path] ?? null])
      )
    })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  const manifest = {
    schema: 'workflow.artifact-manifest/v1' as const,
    executionHostId: params.run.executionHostId,
    workspaceId: params.run.workspace.id,
    entries
  }
  const digest = sha256(JSON.stringify(manifest))
  const materializedPath = await materializeArtifact(params.store, params.run.id, digest, manifest)
  return params.store.saveArtifact({
    runId: params.run.id,
    kind: node.artifactKind,
    executionHostId: params.run.executionHostId,
    worktreeId: params.run.workspace.id,
    locator,
    digest,
    manifest,
    snapshotState: 'frozen',
    producedByStepRunId: params.step.id,
    materializedPath
  })
}

async function changedArtifactPaths(baseline: WorkflowWorkspaceBaseline): Promise<string[]> {
  if (baseline.kind === 'git-worktree') {
    const snapshot = await gitArtifactSnapshot(baseline)
    const deleted = new Set(snapshot.deletedPaths)
    return snapshot.paths.filter((path) => !deleted.has(path))
  }
  return (await changedFolderPaths(baseline)).paths
}

function freezeDeletion(store: WorkflowStore, path: string): WorkflowArtifactManifestEntryV1 {
  const blob = store.putBlob(Buffer.alloc(0))
  return {
    path,
    kind: 'deleted',
    size: blob.size,
    digest: blob.digest,
    blobId: blob.blobId
  }
}

async function freezeFile(
  store: WorkflowStore,
  workspacePath: string,
  path: string
): Promise<WorkflowArtifactManifestEntryV1> {
  const file = await readSnapshotFile(workspacePath, path)
  const blob = store.putBlob(file.content)
  return {
    path: relative(workspacePath, file.absolutePath).split('\\').join('/'),
    kind: 'file',
    size: blob.size,
    digest: blob.digest,
    blobId: blob.blobId
  }
}

async function materializeArtifact(
  store: WorkflowStore,
  runId: string,
  digest: string,
  manifest: {
    schema: 'workflow.artifact-manifest/v1'
    executionHostId: string
    workspaceId: string
    entries: WorkflowArtifactManifestEntryV1[]
  }
): Promise<string> {
  const root = join(tmpdir(), 'orca-workflow-artifacts', runId, digest)
  const blobs = join(root, 'blobs')
  await mkdir(blobs, { recursive: true, mode: 0o700 })
  for (const entry of manifest.entries) {
    const content = store.getBlob(entry.blobId)
    if (!content) {
      throw new WorkflowError(
        'workflow_artifact_unavailable',
        `Artifact Blob ${entry.blobId} is unavailable.`
      )
    }
    const target = join(blobs, entry.digest)
    await writeFile(target, content, { flag: 'wx', mode: 0o400 }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    })
    await chmod(target, 0o400)
  }
  const manifestPath = join(root, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o400
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  })
  await chmod(manifestPath, 0o400)
  return root
}

function collectArtifactPaths(
  envelope: WorkflowCompletionEnvelopeV1,
  workerFilesModified: string[]
): string[] {
  const paths = new Set(workerFilesModified.map(normalizePath).filter(Boolean))
  for (const artifact of envelope.artifacts) {
    for (const [key, value] of Object.entries(artifact.locator)) {
      if (key === 'path' || key === 'filePath') {
        if (typeof value === 'string') {
          paths.add(normalizePath(value))
        }
      } else if ((key === 'paths' || key === 'files') && Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string') {
            paths.add(normalizePath(entry))
          }
        }
      }
    }
  }
  return [...paths].filter(Boolean).sort()
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
