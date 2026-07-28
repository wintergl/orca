import { useMemo } from 'react'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/ai-vault-resume-target'
import { toAiVaultProjectKey } from './ai-vault-session-projects'
import type { AppState } from '@/store/types'
import type { AiVaultScope } from '../../../../shared/ai-vault-types'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import type { ProjectHostSetupProjection } from '../../../../shared/project-host-setup-projection'
import type { Worktree } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AgentActivityWorkspaceInfo } from './agent-activity-types'

type ResumeTargetState = Pick<
  AppState,
  'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'
>

export function useAiVaultAgentActivityWorkspaces(args: {
  activeWorktreeId: string | null | undefined
  activeWorktreePaths: readonly string[]
  allWorktrees: readonly Worktree[]
  projectHostSetupProjection: ProjectHostSetupProjection
  resumeTargetState: ResumeTargetState
  scope: AiVaultScope
}): {
  workspaceInfoById: ReadonlyMap<string, AgentActivityWorkspaceInfo>
  workspaceScopeIds: ReadonlySet<string>
} {
  const workspaceInfoById = useMemo(() => {
    const setupByRepoId = new Map<string, ProjectHostSetupProjection['setups'][number]>()
    for (const setup of args.projectHostSetupProjection.setups) {
      if (setup.repoId) {
        setupByRepoId.set(setup.repoId, setup)
      }
    }
    const result = new Map<string, AgentActivityWorkspaceInfo>()
    for (const worktree of args.allWorktrees) {
      const setup = setupByRepoId.get(worktree.repoId)
      result.set(worktree.id, {
        id: worktree.id,
        title: worktree.displayName || worktree.path,
        projectKey: toAiVaultProjectKey(worktree.projectId ?? setup?.projectId, worktree.repoId),
        executionHostId: getAiVaultResumeWorkspaceExecutionHostId(
          args.resumeTargetState,
          worktree.id
        )
      })
    }
    for (const folderWorkspace of args.resumeTargetState.folderWorkspaces) {
      const id = folderWorkspaceKey(folderWorkspace.id)
      result.set(id, {
        id,
        title: folderWorkspace.name || folderWorkspace.folderPath,
        projectKey: null,
        executionHostId: getAiVaultResumeWorkspaceExecutionHostId(args.resumeTargetState, id)
      })
    }
    return result
  }, [args.allWorktrees, args.projectHostSetupProjection.setups, args.resumeTargetState])

  const workspaceScopeIds = useMemo(() => {
    const ids = new Set<string>()
    if (args.activeWorktreeId) {
      ids.add(args.activeWorktreeId)
    }
    if (args.scope === 'workspace') {
      for (const worktree of args.allWorktrees) {
        if (
          args.activeWorktreePaths.some((pathValue) =>
            isPathInsideOrEqual(pathValue, worktree.path)
          )
        ) {
          ids.add(worktree.id)
        }
      }
    }
    return ids
  }, [args.activeWorktreeId, args.activeWorktreePaths, args.allWorktrees, args.scope])

  return { workspaceInfoById, workspaceScopeIds }
}
