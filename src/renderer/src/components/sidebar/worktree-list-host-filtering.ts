import {
  ALL_EXECUTION_HOSTS_SCOPE,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import type { FolderWorkspacePathStatusRequest } from '../../../../shared/folder-workspace-path-status'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import {
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForFolderPathStatus,
  getProjectGroupExecutionHostIdForRows,
  getRuntimeEnvironmentIdForFolderPathStatusHost
} from './workspace-host-resolution'

export {
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows,
  getRuntimeEnvironmentIdForFolderPathStatusHost
}

/** null means every host is visible. */
export function getVisibleSidebarHostIdSet(
  visibleWorkspaceHostIds: readonly ExecutionHostId[] | null | undefined,
  workspaceHostScope: ExecutionHostScope
): Set<ExecutionHostId> | null {
  const visibleHostIds =
    visibleWorkspaceHostIds ??
    (workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [workspaceHostScope])
  return visibleHostIds ? new Set<ExecutionHostId>(visibleHostIds) : null
}

// Why: sidebar rendering and Cmd+1–9 must use the same host-filtered order.
export function filterProjectGroupsForVisibleHosts(
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly ProjectGroup[] {
  if (!visibleHostIdSet) {
    return projectGroups
  }
  return projectGroups.filter((group) =>
    visibleHostIdSet.has(getProjectGroupExecutionHostIdForRows(group, defaultHostId))
  )
}

export function filterFolderWorkspacesForVisibleHosts(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly FolderWorkspace[] {
  if (!visibleHostIdSet) {
    return folderWorkspaces
  }
  const projectGroupById = new Map(projectGroups.map((group) => [group.id, group]))
  return folderWorkspaces.filter((folderWorkspace) =>
    visibleHostIdSet.has(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace,
        projectGroup: projectGroupById.get(folderWorkspace.projectGroupId),
        defaultHostId
      })
    )
  )
}

export function getFolderPathStatusRouteOptionsForRows({
  request,
  projectGroupsById,
  folderWorkspacesById
}: {
  request: FolderWorkspacePathStatusRequest
  projectGroupsById: ReadonlyMap<string, ProjectGroup>
  folderWorkspacesById: ReadonlyMap<string, FolderWorkspace>
}): { runtimeEnvironmentId: string | null } | undefined {
  const folderWorkspace =
    request.scope === 'folder-workspace'
      ? folderWorkspacesById.get(request.folderWorkspaceId)
      : undefined
  const group =
    request.scope === 'project-group'
      ? projectGroupsById.get(request.projectGroupId)
      : projectGroupsById.get(folderWorkspace?.projectGroupId ?? '')
  if (!group) {
    return undefined
  }
  const hostId =
    request.scope === 'project-group'
      ? getProjectGroupExecutionHostIdForFolderPathStatus(group)
      : getFolderWorkspaceExecutionHostIdForRows({
          folderWorkspace: folderWorkspace ?? { connectionId: null },
          projectGroup: group,
          defaultHostId: getProjectGroupExecutionHostIdForFolderPathStatus(group)
        })
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForFolderPathStatusHost(hostId)
  return { runtimeEnvironmentId }
}
