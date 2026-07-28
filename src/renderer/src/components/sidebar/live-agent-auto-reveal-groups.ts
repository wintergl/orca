import type { AppState } from '@/store/types'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type {
  FolderWorkspace,
  ProjectGroup,
  Repo,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  getFolderWorkspaceRevealGroupKeys,
  getKnownSidebarWorktreeById
} from './worktree-list-folder-reveal'
import {
  getGroupKeysForWorktree,
  getLineageGroupKey,
  PINNED_GROUP_KEY,
  type PinnedWorktreeDisplayPolicy,
  type ProjectGroupingModel,
  type WorktreeGroupBy
} from './worktree-list-groups'
import {
  getFolderWorkspaceExecutionHostIdForRows,
  getWorktreeExecutionHostIdForRows
} from './workspace-host-resolution'

export type LiveAgentAutoRevealGroupsArgs = {
  collapsedGroups: ReadonlySet<string>
  liveWorkspaceIds: ReadonlySet<string>
  groupBy: WorktreeGroupBy
  worktreeMap: ReadonlyMap<string, Worktree>
  repoMap: Map<string, Repo>
  prCache: Record<string, unknown> | null
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  settings: AppState['settings']
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
  folderWorkspaces: readonly FolderWorkspace[]
  worktreeLineageById: Record<string, WorktreeLineage>
  defaultHostId: ExecutionHostId
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
}

function deleteHostGroup(next: Set<string>, hostId: ExecutionHostId): void {
  next.delete(`host:${hostId}`)
}

function revealWorktreeLineage(args: {
  next: Set<string>
  worktree: Worktree
  worktreeMap: ReadonlyMap<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
}): void {
  const seen = new Set<string>()
  let current: Worktree | undefined = args.worktree
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const lineage = args.worktreeLineageById[current.id]
    const parent = lineage ? args.worktreeMap.get(lineage.parentWorktreeId) : undefined
    if (
      !lineage ||
      !parent ||
      current.instanceId !== lineage.worktreeInstanceId ||
      parent.instanceId !== lineage.parentWorktreeInstanceId
    ) {
      break
    }
    args.next.delete(getLineageGroupKey(parent.id))
    current = parent
  }
}

function revealFolderWorkspace(args: {
  next: Set<string>
  workspaceId: string
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  defaultHostId: ExecutionHostId
}): boolean {
  const scope = parseWorkspaceKey(args.workspaceId)
  if (scope?.type !== 'folder') {
    return false
  }
  const folderWorkspace =
    args.folderWorkspaces.find((workspace) => workspace.id === scope.folderWorkspaceId) ?? null
  if (!folderWorkspace) {
    return false
  }
  for (const groupKey of getFolderWorkspaceRevealGroupKeys(
    folderWorkspaceKey(folderWorkspace.id),
    args.folderWorkspaces,
    args.projectGroups
  )) {
    args.next.delete(groupKey)
  }
  const projectGroupsById = new Map(args.projectGroups.map((group) => [group.id, group]))
  const hostId = getFolderWorkspaceExecutionHostIdForRows({
    folderWorkspace,
    projectGroup: projectGroupsById.get(folderWorkspace.projectGroupId),
    defaultHostId: args.defaultHostId
  })
  deleteHostGroup(args.next, hostId)
  return true
}

function revealWorktree(
  args: LiveAgentAutoRevealGroupsArgs & { next: Set<string>; worktree: Worktree }
): void {
  const repo = args.repoMap.get(args.worktree.repoId)
  const hostId = getWorktreeExecutionHostIdForRows({
    worktree: args.worktree,
    repo,
    defaultHostId: args.defaultHostId
  })
  deleteHostGroup(args.next, hostId)

  revealWorktreeLineage({
    next: args.next,
    worktree: args.worktree,
    worktreeMap: args.worktreeMap,
    worktreeLineageById: args.worktreeLineageById
  })

  if (args.worktree.isPinned && args.pinnedDisplayPolicy === 'single-location') {
    args.next.delete(PINNED_GROUP_KEY)
    return
  }

  for (const groupKey of getGroupKeysForWorktree(
    args.groupBy,
    args.worktree,
    args.repoMap,
    args.prCache,
    args.workspaceStatuses,
    args.settings,
    args.projectGroups,
    args.projectGrouping
  )) {
    args.next.delete(groupKey)
  }
}

export function getLiveAgentAutoRevealCollapsedGroups(
  args: LiveAgentAutoRevealGroupsArgs
): Set<string> {
  if (args.liveWorkspaceIds.size === 0) {
    return args.collapsedGroups instanceof Set
      ? args.collapsedGroups
      : new Set(args.collapsedGroups)
  }
  const next = new Set(args.collapsedGroups)
  for (const workspaceId of args.liveWorkspaceIds) {
    if (
      revealFolderWorkspace({
        next,
        workspaceId,
        folderWorkspaces: args.folderWorkspaces,
        projectGroups: args.projectGroups,
        defaultHostId: args.defaultHostId
      })
    ) {
      continue
    }
    const worktree = getKnownSidebarWorktreeById(
      workspaceId,
      args.worktreeMap,
      args.folderWorkspaces
    )
    if (worktree) {
      revealWorktree({ ...args, next, worktree })
    }
  }
  return next
}
