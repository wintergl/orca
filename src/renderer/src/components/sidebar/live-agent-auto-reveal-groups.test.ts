import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { getLiveAgentAutoRevealCollapsedGroups } from './live-agent-auto-reveal-groups'
import { getProjectGroupHeaderKey, PINNED_GROUP_KEY } from './worktree-list-groups'

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#000000',
    addedAt: 1,
    ...overrides
  }
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo/wt-1',
    branch: 'main',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: 'Worktree',
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

function projectGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Group',
    parentPath: '/repo',
    connectionId: null,
    executionHostId: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function folderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'folder-1',
    projectGroupId: 'group-1',
    name: 'Folder workspace',
    folderPath: '/repo/folder',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function reveal(args: {
  collapsedGroups: ReadonlySet<string>
  liveWorkspaceIds: ReadonlySet<string>
  worktrees?: readonly Worktree[]
  repos?: readonly Repo[]
  projectGroups?: readonly ProjectGroup[]
  folderWorkspaces?: readonly FolderWorkspace[]
  pinnedDisplayPolicy?: 'single-location' | 'duplicate-in-groups'
}): Set<string> {
  const worktrees = args.worktrees ?? [worktree()]
  const repos = args.repos ?? [repo()]
  return getLiveAgentAutoRevealCollapsedGroups({
    collapsedGroups: args.collapsedGroups,
    liveWorkspaceIds: args.liveWorkspaceIds,
    groupBy: 'repo',
    worktreeMap: new Map(worktrees.map((item) => [item.id, item])),
    repoMap: new Map(repos.map((item) => [item.id, item])),
    prCache: null,
    workspaceStatuses: [],
    settings: {} as never,
    projectGroups: args.projectGroups ?? [],
    projectGrouping: undefined,
    folderWorkspaces: args.folderWorkspaces ?? [],
    worktreeLineageById: {},
    defaultHostId: 'local',
    pinnedDisplayPolicy: args.pinnedDisplayPolicy ?? 'single-location'
  })
}

describe('getLiveAgentAutoRevealCollapsedGroups', () => {
  it('opens only the pinned section for a live pinned worktree in single-location mode', () => {
    const pinned = worktree({ isPinned: true })
    const next = reveal({
      collapsedGroups: new Set([PINNED_GROUP_KEY, 'repo:repo-1']),
      liveWorkspaceIds: new Set([pinned.id]),
      worktrees: [pinned],
      pinnedDisplayPolicy: 'single-location'
    })

    expect(next.has(PINNED_GROUP_KEY)).toBe(false)
    expect(next.has('repo:repo-1')).toBe(true)
  })

  it('opens only the natural group for a live pinned worktree in duplicate mode', () => {
    const pinned = worktree({ isPinned: true })
    const next = reveal({
      collapsedGroups: new Set([PINNED_GROUP_KEY, 'repo:repo-1']),
      liveWorkspaceIds: new Set([pinned.id]),
      worktrees: [pinned],
      pinnedDisplayPolicy: 'duplicate-in-groups'
    })

    expect(next.has(PINNED_GROUP_KEY)).toBe(true)
    expect(next.has('repo:repo-1')).toBe(false)
  })

  it('opens folder workspace project ancestors and its runtime host section', () => {
    const parent = projectGroup({ id: 'parent' })
    const child = projectGroup({
      id: 'child',
      parentGroupId: parent.id,
      executionHostId: 'runtime:env-1'
    })
    const folder = folderWorkspace({ projectGroupId: child.id })
    const next = reveal({
      collapsedGroups: new Set([
        getProjectGroupHeaderKey(parent.id),
        getProjectGroupHeaderKey(child.id),
        'host:runtime:env-1'
      ]),
      liveWorkspaceIds: new Set([folderWorkspaceKey(folder.id)]),
      projectGroups: [parent, child],
      folderWorkspaces: [folder]
    })

    expect(next.has(getProjectGroupHeaderKey(parent.id))).toBe(false)
    expect(next.has(getProjectGroupHeaderKey(child.id))).toBe(false)
    expect(next.has('host:runtime:env-1')).toBe(false)
  })
})
