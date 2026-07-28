import {
  ALL_EXECUTION_HOSTS_SCOPE,
  toSshExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import type { AiVaultAgent, AiVaultScope } from '../../../../shared/ai-vault-types'
import type {
  AgentActivityItem,
  AgentActivitySource,
  AgentActivityWorkspaceInfo,
  BuildAgentActivityArgs
} from './agent-activity-types'

export function sourceExecutionHostId(
  source: AgentActivitySource,
  workspace: AgentActivityWorkspaceInfo | undefined
): ExecutionHostId | null {
  return (
    source.lifecycle?.executionHostId ??
    source.entry.executionHostId ??
    workspace?.executionHostId ??
    (source.entry.connectionId ? toSshExecutionHostId(source.entry.connectionId) : null)
  )
}

export function sourceMatchesScope(args: {
  vaultAgent: AiVaultAgent | null
  executionHostId: ExecutionHostId | null
  worktreeId: string
  workspace: AgentActivityWorkspaceInfo | undefined
  enabledVaultAgents: ReadonlySet<AiVaultAgent>
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
}): boolean {
  if (!args.vaultAgent || !args.enabledVaultAgents.has(args.vaultAgent)) {
    return false
  }
  if (
    args.executionHostScope !== ALL_EXECUTION_HOSTS_SCOPE &&
    args.executionHostId !== args.executionHostScope
  ) {
    return false
  }
  if (args.vaultScope === 'workspace') {
    return args.workspaceScopeIds.has(args.worktreeId)
  }
  if (args.vaultScope === 'project') {
    return Boolean(
      args.activeProjectKey &&
      args.workspace?.projectKey &&
      args.workspace.projectKey === args.activeProjectKey
    )
  }
  return true
}

export function visibleInAgentVault(args: {
  item: AgentActivityItem
  workspace: AgentActivityWorkspaceInfo | undefined
  filters: BuildAgentActivityArgs
  enabledVaultAgents: ReadonlySet<AiVaultAgent>
}): boolean {
  if (args.item.matchedSession) {
    return args.filters.filteredSessionIds.has(args.item.matchedSession.id)
  }
  if (args.filters.hasSearchQuery || !args.item.worktreeId) {
    return false
  }
  return sourceMatchesScope({
    vaultAgent: args.item.vaultAgent,
    executionHostId: args.item.executionHostId,
    worktreeId: args.item.worktreeId,
    workspace: args.workspace,
    enabledVaultAgents: args.enabledVaultAgents,
    vaultScope: args.filters.vaultScope,
    executionHostScope: args.filters.executionHostScope,
    activeProjectKey: args.filters.activeProjectKey,
    workspaceScopeIds: args.filters.workspaceScopeIds
  })
}
