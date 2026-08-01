import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getProjectIdentityKey } from '../../../../shared/project-host-setup-projection'
import { getWorktreeExecutionHostId } from '../../../../shared/execution-host'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { Worktree } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getActiveRuntimeTarget, type RuntimeClientTarget } from '@/runtime/runtime-client-target'

export type WorkflowWorkspaceContext = {
  projectIdentity: string
  projectName: string
  workspaceId: string
  workspaceName: string
  workspaceKind: 'git-worktree' | 'folder-workspace'
  executionHostId: string
  target: RuntimeClientTarget
}

export function useWorkflowWorkspaceContext(): {
  context: WorkflowWorkspaceContext | null
  fallbackTarget: RuntimeClientTarget
} {
  const state = useAppStore(
    useShallow((store) => ({
      activeWorktreeId: store.activeWorktreeId,
      repos: store.repos,
      settings: store.settings,
      worktreesByRepo: store.worktreesByRepo
    }))
  )
  return useMemo(() => {
    const worktree = findWorktree(state.worktreesByRepo, state.activeWorktreeId)
    const repo = worktree
      ? (state.repos.find((candidate) => candidate.id === worktree.repoId) ?? null)
      : null
    const fallbackTarget = getActiveRuntimeTarget(state.settings)
    if (!worktree || !repo) {
      return { context: null, fallbackTarget }
    }
    const target = getActiveRuntimeTarget(getSettingsForRepoRuntimeOwner(state, repo.id))
    return {
      fallbackTarget,
      context: {
        projectIdentity: getProjectIdentityKey(repo),
        projectName: repo.displayName,
        workspaceId: worktree.id,
        workspaceName: worktree.displayName,
        workspaceKind: isFolderRepo(repo) ? 'folder-workspace' : 'git-worktree',
        executionHostId: getWorktreeExecutionHostId(worktree, repo),
        target
      }
    }
  }, [state])
}

function findWorktree(
  worktreesByRepo: Record<string, Worktree[]>,
  activeWorktreeId: string | null
): Worktree | null {
  if (!activeWorktreeId) {
    return null
  }
  for (const worktrees of Object.values(worktreesByRepo)) {
    const worktree = worktrees.find((candidate) => candidate.id === activeWorktreeId)
    if (worktree) {
      return worktree
    }
  }
  return null
}
