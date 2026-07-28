import type React from 'react'
import { useMemo } from 'react'
import type { ProjectHostSetupProjection } from '../../../../shared/project-host-setup-projection'
import type { AiVaultAgent, AiVaultScope, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostScope } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/types'
import type { AppState } from '@/store/types'
import { AgentActivityBox } from './AgentActivityBox'
import { useAiVaultAgentActivity } from './use-ai-vault-agent-activity'
import { useAiVaultAgentActivityWorkspaces } from './use-ai-vault-agent-activity-workspaces'
import type { AiVaultOriginalPaneTarget } from './ai-vault-original-pane'

type ResumeTargetState = Pick<
  AppState,
  'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'
>

type AiVaultAgentActivityInputs = {
  activeProjectKey: string | null
  activeWorktreeId: string | null | undefined
  activeWorktreePaths: readonly string[]
  allWorktrees: readonly Worktree[]
  enabledVaultAgents: readonly AiVaultAgent[]
  executionHostScope: ExecutionHostScope
  filteredSessions: readonly AiVaultSession[]
  projectHostSetupProjection: ProjectHostSetupProjection
  query: string
  resumeTargetState: ResumeTargetState
  scope: AiVaultScope
  sessions: readonly AiVaultSession[]
}

export function AiVaultAgentActivitySection(args: {
  activity: AiVaultAgentActivityInputs
  getOriginalPaneTarget: (session: AiVaultSession) => AiVaultOriginalPaneTarget | null
  onOpenOriginalPane: (session: AiVaultSession) => void
}): React.JSX.Element | null {
  const { workspaceInfoById, workspaceScopeIds } = useAiVaultAgentActivityWorkspaces(args.activity)
  const filteredSessionIds = useMemo(
    () => new Set(args.activity.filteredSessions.map((session) => session.id)),
    [args.activity.filteredSessions]
  )
  const model = useAiVaultAgentActivity({
    sessions: args.activity.sessions,
    filteredSessionIds,
    hasSearchQuery: args.activity.query.trim().length > 0,
    enabledVaultAgents: args.activity.enabledVaultAgents,
    vaultScope: args.activity.scope,
    executionHostScope: args.activity.executionHostScope,
    activeProjectKey: args.activity.activeProjectKey,
    workspaceScopeIds,
    workspaceInfoById
  })

  return (
    <AgentActivityBox
      model={model}
      getOriginalPaneTarget={args.getOriginalPaneTarget}
      onOpenOriginalPane={args.onOpenOriginalPane}
    />
  )
}
