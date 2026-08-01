import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { relative, resolve, sep } from 'node:path'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WorkflowError } from './workflow-error'

const execFileAsync = promisify(execFile)
const MAX_FOLDER_FILES = 20_000
const MAX_FOLDER_BYTES = 100 * 1024 * 1024
const MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.orca',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage'
])

export type GitWorkspaceBaseline = {
  kind: 'git-worktree'
  workspacePath: string
  headSha: string
  guardDigest: string
}

export type FolderFileBaseline = {
  digest: string
  size: number
  mtimeMs: number
}

export type FolderWorkspaceBaseline = {
  kind: 'folder-workspace'
  workspacePath: string
  files: Record<string, FolderFileBaseline>
  guardDigest: string
}

export type WorkflowWorkspaceBaseline = GitWorkspaceBaseline | FolderWorkspaceBaseline

export async function captureWorkspaceBaseline(
  runtime: OrcaRuntimeService,
  run: WorkflowRunRecord
): Promise<WorkflowWorkspaceBaseline> {
  const workspacePath = await resolveWorkflowWorkspacePath(runtime, run.workspace.id)
  if (run.workspace.kind === 'git-worktree') {
    const headSha = (await git(workspacePath, ['rev-parse', 'HEAD'])).trim()
    return {
      kind: 'git-worktree',
      workspacePath,
      headSha,
      guardDigest: await gitGuardDigest(workspacePath)
    }
  }
  const scan = await scanFolderWorkspace(workspacePath)
  return {
    kind: 'folder-workspace',
    workspacePath,
    files: scan.files,
    guardDigest: scan.guardDigest
  }
}

export async function workspaceGuardDigest(baseline: WorkflowWorkspaceBaseline): Promise<string> {
  return baseline.kind === 'git-worktree'
    ? gitGuardDigest(baseline.workspacePath)
    : (await scanFolderWorkspace(baseline.workspacePath)).guardDigest
}

export async function changedFolderPaths(baseline: FolderWorkspaceBaseline): Promise<{
  paths: string[]
  deletedPaths: string[]
  currentFiles: Record<string, FolderFileBaseline>
  guardDigest: string
}> {
  const current = await scanFolderWorkspace(baseline.workspacePath)
  const paths = new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])
  const changedPaths = [...paths].filter(
    (path) => baseline.files[path]?.digest !== current.files[path]?.digest
  )
  return {
    paths: changedPaths.filter((path) => current.files[path] !== undefined).sort(),
    deletedPaths: changedPaths.filter((path) => current.files[path] === undefined).sort(),
    currentFiles: current.files,
    guardDigest: current.guardDigest
  }
}

export async function gitArtifactSnapshot(baseline: GitWorkspaceBaseline): Promise<{
  baseSha: string
  headSha: string
  diff: Buffer
  paths: string[]
  deletedPaths: string[]
  dirty: boolean
  guardDigest: string
}> {
  const headSha = (await git(baseline.workspacePath, ['rev-parse', 'HEAD'])).trim()
  const [diffText, trackedNames, untrackedNames, statusText] = await Promise.all([
    git(baseline.workspacePath, ['diff', '--binary', baseline.headSha]),
    git(baseline.workspacePath, ['diff', '--name-only', '-z', baseline.headSha]),
    git(baseline.workspacePath, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(baseline.workspacePath, ['status', '--porcelain=v1', '-z'])
  ])
  const paths = new Set([...nulPaths(trackedNames), ...nulPaths(untrackedNames)])
  const safePaths = [...paths].filter(isSnapshotRelativePath).sort()
  const deletedPaths: string[] = []
  for (const path of safePaths) {
    try {
      await lstat(resolve(baseline.workspacePath, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      deletedPaths.push(path)
    }
  }
  return {
    baseSha: baseline.headSha,
    headSha,
    diff: Buffer.from(diffText),
    paths: safePaths,
    deletedPaths,
    dirty: statusText.length > 0,
    guardDigest: await gitGuardDigest(baseline.workspacePath)
  }
}

export async function readSnapshotFile(
  workspacePath: string,
  relativePath: string
): Promise<{ content: Buffer; absolutePath: string; mtimeMs: number }> {
  if (!isSnapshotRelativePath(relativePath)) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      `Artifact path is outside the workspace: ${relativePath}`
    )
  }
  const absolutePath = resolve(workspacePath, relativePath)
  const nominalRoot = `${resolve(workspacePath)}${sep}`
  if (!absolutePath.startsWith(nominalRoot)) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      `Artifact path is outside the workspace: ${relativePath}`
    )
  }
  const root = `${await realpath(resolve(workspacePath))}${sep}`
  const directStat = await lstat(absolutePath)
  const canonicalPath = await realpath(absolutePath)
  if (!canonicalPath.startsWith(root) || !directStat.isFile()) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      `Artifact file is not a supported regular file: ${relativePath}`
    )
  }
  const fileStat = await stat(canonicalPath)
  if (!fileStat.isFile() || fileStat.size > MAX_SNAPSHOT_FILE_BYTES) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      `Artifact file is not a supported regular file: ${relativePath}`
    )
  }
  return { content: await readFile(canonicalPath), absolutePath, mtimeMs: fileStat.mtimeMs }
}

export async function resolveWorkflowWorkspacePath(
  runtime: OrcaRuntimeService,
  workspaceId: string
): Promise<string> {
  const workspace = await runtime.showManagedWorktree(`id:${workspaceId}`)
  const path = workspace.git.path
  if (!path) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      'Workflow workspace path is unavailable on the execution host.'
    )
  }
  return resolve(path)
}

async function scanFolderWorkspace(
  workspacePath: string
): Promise<{ files: Record<string, FolderFileBaseline>; guardDigest: string }> {
  const files: Record<string, FolderFileBaseline> = Object.create(null)
  let totalBytes = 0
  const pending = [workspacePath]
  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const fileStat = await stat(absolutePath)
      if (fileStat.size > MAX_SNAPSHOT_FILE_BYTES) {
        continue
      }
      totalBytes += fileStat.size
      if (Object.keys(files).length >= MAX_FOLDER_FILES || totalBytes > MAX_FOLDER_BYTES) {
        throw new WorkflowError(
          'workflow_artifact_unavailable',
          'Folder Workspace exceeds the M2 snapshot safety limit.'
        )
      }
      const content = await readFile(absolutePath)
      const path = normalizeRelativePath(relative(workspacePath, absolutePath))
      files[path] = {
        digest: sha256(content),
        size: content.length,
        mtimeMs: fileStat.mtimeMs
      }
    }
  }
  return { files, guardDigest: sha256(JSON.stringify(sortRecord(files))) }
}

async function gitGuardDigest(workspacePath: string): Promise<string> {
  const [head, status, diff, untracked] = await Promise.all([
    git(workspacePath, ['rev-parse', 'HEAD']),
    git(workspacePath, ['status', '--porcelain=v1', '-z']),
    git(workspacePath, ['diff', '--binary', 'HEAD']),
    git(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z'])
  ])
  const untrackedFiles: [string, string][] = []
  for (const path of nulPaths(untracked).filter(isSnapshotRelativePath).sort()) {
    const file = await readSnapshotFile(workspacePath, path)
    untrackedFiles.push([path, sha256(file.content)])
  }
  return sha256(`${head}\0${status}\0${diff}\0${JSON.stringify(untrackedFiles)}`)
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    })
    return result.stdout
  } catch (error) {
    throw new WorkflowError(
      'workflow_artifact_unavailable',
      `Git snapshot command failed: git ${args.join(' ')}`,
      String(error)
    )
  }
}

function nulPaths(value: string): string[] {
  return value.split('\0').filter(Boolean)
}

function isSnapshotRelativePath(value: string): boolean {
  const normalized = normalizeRelativePath(value)
  const segments = normalized.split('/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('../') &&
    !normalized.startsWith('/') &&
    !segments.some((segment) => IGNORED_DIRECTORIES.has(segment))
  )
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  )
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
