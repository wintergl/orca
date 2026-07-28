import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'

export function getRepoExecutionHostIdForRows(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  if (repo?.connectionId || repo?.executionHostId) {
    return getRepoExecutionHostId(repo)
  }
  return defaultHostId
}

export function getProjectGroupExecutionHostIdForRows(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : defaultHostId
}

export function getFolderWorkspaceExecutionHostIdForRows({
  folderWorkspace,
  projectGroup,
  defaultHostId
}: {
  folderWorkspace: Pick<FolderWorkspace, 'connectionId'>
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId'> | undefined
  defaultHostId: ExecutionHostId
}): ExecutionHostId {
  if (projectGroup) {
    const explicitProjectGroupHostId = normalizeExecutionHostId(projectGroup.executionHostId)
    if (explicitProjectGroupHostId) {
      return explicitProjectGroupHostId
    }
    const projectGroupHostId = getProjectGroupExecutionHostIdForRows(projectGroup, defaultHostId)
    if (projectGroupHostId !== defaultHostId || !folderWorkspace.connectionId) {
      return projectGroupHostId
    }
  }
  return folderWorkspace.connectionId
    ? toSshExecutionHostId(folderWorkspace.connectionId)
    : defaultHostId
}

export function getWorktreeExecutionHostIdForRows({
  worktree,
  repo,
  defaultHostId
}: {
  worktree: Worktree
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined
  defaultHostId: ExecutionHostId
}): ExecutionHostId {
  return getWorktreeExecutionHostId(worktree, repo, defaultHostId)
}

export function getRuntimeEnvironmentIdForFolderPathStatusHost(
  hostId: ExecutionHostId
): string | null {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'runtime' ? parsed.environmentId : null
}

export function getProjectGroupExecutionHostIdForFolderPathStatus(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : 'local'
}
