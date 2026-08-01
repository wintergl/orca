import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowCompletionEnvelopeV1 } from '../../../shared/workflow-result-schema'
import { freezeWorkflowArtifact } from './workflow-artifact-store'
import { WorkflowStore } from './workflow-store'
import type { GitWorkspaceBaseline } from './workflow-workspace-snapshot'

const runGit = promisify(execFile)
const cleanupPaths: string[] = []
const stores: WorkflowStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close()
  }
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe('Workflow Artifact Store', () => {
  it('freezes tracked and untracked Git content into immutable addressable Blobs', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-git-artifact-'))
    cleanupPaths.push(workspacePath)
    await git(workspacePath, ['init'])
    await writeFile(join(workspacePath, 'tracked.ts'), 'export const tracked = 1\n')
    await git(workspacePath, ['add', 'tracked.ts'])
    await git(workspacePath, [
      '-c',
      'user.name=Orca Test',
      '-c',
      'user.email=orca@example.invalid',
      'commit',
      '-m',
      'baseline'
    ])
    const headSha = await git(workspacePath, ['rev-parse', 'HEAD'])
    const baseline: GitWorkspaceBaseline = {
      kind: 'git-worktree',
      workspacePath,
      headSha,
      guardDigest: 'baseline'
    }
    await writeFile(join(workspacePath, 'tracked.ts'), 'export const tracked = 2\n')
    await writeFile(join(workspacePath, 'untracked.ts'), 'export const untracked = 1\n')
    const dependencyPath = await mkdtemp(join(tmpdir(), 'orca-workflow-dependencies-'))
    cleanupPaths.push(dependencyPath)
    await mkdir(join(workspacePath, 'outputs', 'group'), { recursive: true })
    await symlink(
      dependencyPath,
      join(workspacePath, 'outputs', 'group', 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const store = new WorkflowStore(':memory:')
    stores.push(store)

    const artifact = await freezeWorkflowArtifact({
      store,
      run: runRecord(),
      step: produceStep(),
      envelope: completionEnvelope(),
      baseline,
      workerFilesModified: ['tracked.ts', 'untracked.ts']
    })
    cleanupPaths.push(artifact.materializedPath!)

    expect(artifact.locator).toMatchObject({
      baseSha: headSha,
      modifiedFiles: ['tracked.ts', 'untracked.ts'],
      hasUncommittedChanges: true
    })
    expect(artifact.manifest.entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ['git.diff', 'git-diff'],
      ['tracked.ts', 'file'],
      ['untracked.ts', 'file']
    ])
    const untracked = artifact.manifest.entries.find((entry) => entry.path === 'untracked.ts')!
    const frozenPath = join(artifact.materializedPath!, 'blobs', untracked.digest)
    expect(await readFile(frozenPath, 'utf8')).toBe('export const untracked = 1\n')
    await writeFile(join(workspacePath, 'untracked.ts'), 'export const untracked = 9\n')
    expect(await readFile(frozenPath, 'utf8')).toBe('export const untracked = 1\n')
  })

  it('freezes and materializes a multi-megabyte Artifact without truncation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-large-artifact-'))
    cleanupPaths.push(workspacePath)
    const largeContent = Buffer.alloc(2 * 1024 * 1024, 0x61)
    await writeFile(join(workspacePath, 'large-spec.md'), largeContent)
    const store = new WorkflowStore(':memory:')
    stores.push(store)

    const artifact = await freezeWorkflowArtifact({
      store,
      run: runRecord('spec'),
      step: produceStep(),
      envelope: completionEnvelope('spec', ['large-spec.md']),
      baseline: {
        kind: 'folder-workspace',
        workspacePath,
        files: {},
        guardDigest: 'baseline'
      },
      workerFilesModified: ['large-spec.md']
    })
    cleanupPaths.push(artifact.materializedPath!)

    const entry = artifact.manifest.entries[0]!
    const frozen = await readFile(join(artifact.materializedPath!, 'blobs', entry.digest))
    expect(entry.size).toBe(largeContent.length)
    expect(frozen.equals(largeContent)).toBe(true)
  })

  it('ignores reported Folder Workspace directories outside the safe file scan', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-folder-artifact-'))
    cleanupPaths.push(workspacePath)
    await mkdir(join(workspacePath, 'outputs', 'group', 'node_modules'), { recursive: true })
    await writeFile(
      join(workspacePath, 'outputs', 'group', 'result.ts'),
      'export const value = 1\n'
    )
    await writeFile(join(workspacePath, 'outputs', 'group', 'node_modules', 'package.json'), '{}\n')
    const store = new WorkflowStore(':memory:')
    stores.push(store)

    const artifact = await freezeWorkflowArtifact({
      store,
      run: runRecord(),
      step: produceStep(),
      envelope: completionEnvelope('code', [
        'outputs/group/result.ts',
        'outputs/group/node_modules'
      ]),
      baseline: {
        kind: 'folder-workspace',
        workspacePath,
        files: {},
        guardDigest: 'baseline'
      },
      workerFilesModified: [
        'outputs/group/result.ts',
        'outputs/group/node_modules',
        'outputs/group/missing.ts'
      ]
    })
    cleanupPaths.push(artifact.materializedPath!)

    expect(artifact.manifest.entries.map((entry) => entry.path)).toEqual([
      'outputs/group/result.ts'
    ])
    expect(artifact.locator).toMatchObject({
      files: ['outputs/group/result.ts'],
      deletedFiles: []
    })
  })
})

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit('git', args, { cwd, encoding: 'utf8' })
  return result.stdout.trim()
}

function runRecord(artifactKind: 'spec' | 'code' = 'code'): WorkflowRunRecord {
  return {
    id: 'run-git',
    executionHostId: 'local',
    workspace: { kind: 'git-worktree', id: 'worktree-git' },
    templateSnapshot: {
      nodes: [{ id: 'code-produce', type: 'produce', artifactKind }]
    }
  } as WorkflowRunRecord
}

function produceStep(): WorkflowStepRunRecord {
  return { id: 'step-produce', nodeId: 'code-produce' } as WorkflowStepRunRecord
}

function completionEnvelope(
  kind: 'spec' | 'code' = 'code',
  paths = ['tracked.ts', 'untracked.ts']
): WorkflowCompletionEnvelopeV1 {
  return {
    schema: 'workflow.completion/v1',
    taskId: 'task-produce',
    dispatchId: 'dispatch-produce',
    workflowRunId: 'run-git',
    stepRunId: 'step-produce',
    agentLifecycleId: 'producer',
    providerSessionId: 'session-producer',
    executionHostId: 'local',
    outcome: 'succeeded',
    summary: 'Changed tracked and untracked files.',
    finalConclusionMarkdown: 'The Git changes are complete.',
    artifacts: [{ kind, locator: { paths } }],
    validations: [],
    unresolved: [],
    readyForNextStep: true
  }
}
