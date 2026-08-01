import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AiVaultAgent, AiVaultScope, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostScope } from '../../../../shared/execution-host'
import {
  buildAgentActivity,
  type AgentActivityModel,
  type AgentActivityWorkspaceInfo
} from './agent-activity-model'

type UseAiVaultAgentActivityArgs = {
  sessions: readonly AiVaultSession[]
  filteredSessionIds: ReadonlySet<string>
  hasSearchQuery: boolean
  enabledVaultAgents: readonly AiVaultAgent[]
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
  workspaceInfoById: ReadonlyMap<string, AgentActivityWorkspaceInfo>
}

export function useAiVaultAgentActivity(args: UseAiVaultAgentActivityArgs): AgentActivityModel {
  const inputs = useAppStore(
    useShallow((state) => ({
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      retainedAgentsByPaneKey: state.retainedAgentsByPaneKey,
      paneForegroundAgentByPaneKey: state.paneForegroundAgentByPaneKey,
      paneAgentLifecycleByPaneKey: state.paneAgentLifecycleByPaneKey,
      tabsByWorktree: state.tabsByWorktree,
      runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
      ptyIdsByTabId: state.ptyIdsByTabId,
      terminalLayoutsByTabId: state.terminalLayoutsByTabId,
      runtimeAgentOrchestrationByPaneKey: state.runtimeAgentOrchestrationByPaneKey,
      generatedTitlesEnabled: state.settings?.tabAutoGenerateTitle === true,
      agentStatusEpoch: state.agentStatusEpoch
    }))
  )
  const {
    sessions,
    filteredSessionIds,
    hasSearchQuery,
    enabledVaultAgents,
    vaultScope,
    executionHostScope,
    activeProjectKey,
    workspaceScopeIds,
    workspaceInfoById
  } = args
  return useMemo(() => {
    void inputs.agentStatusEpoch
    return buildAgentActivity({
      sessions,
      filteredSessionIds,
      hasSearchQuery,
      enabledVaultAgents,
      vaultScope,
      executionHostScope,
      activeProjectKey,
      workspaceScopeIds,
      workspaceInfoById,
      agentStatusByPaneKey: inputs.agentStatusByPaneKey,
      retainedAgentsByPaneKey: inputs.retainedAgentsByPaneKey,
      paneForegroundAgentByPaneKey: inputs.paneForegroundAgentByPaneKey,
      paneAgentLifecycleByPaneKey: inputs.paneAgentLifecycleByPaneKey,
      tabsByWorktree: inputs.tabsByWorktree,
      runtimePaneTitlesByTabId: inputs.runtimePaneTitlesByTabId,
      ptyIdsByTabId: inputs.ptyIdsByTabId,
      terminalLayoutsByTabId: inputs.terminalLayoutsByTabId,
      runtimeAgentOrchestrationByPaneKey: inputs.runtimeAgentOrchestrationByPaneKey,
      generatedTitlesEnabled: inputs.generatedTitlesEnabled,
      now: Date.now()
    })
  }, [
    activeProjectKey,
    enabledVaultAgents,
    executionHostScope,
    filteredSessionIds,
    hasSearchQuery,
    inputs,
    sessions,
    vaultScope,
    workspaceInfoById,
    workspaceScopeIds
  ])
}
