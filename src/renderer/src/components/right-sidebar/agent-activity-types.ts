import type {
  AgentStatusOrchestrationContext,
  AgentStatusState,
  AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { AiVaultAgent, AiVaultScope, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostId, ExecutionHostScope } from '../../../../shared/execution-host'
import type { TerminalLayoutSnapshot, TerminalTab, TuiAgent } from '../../../../shared/types'
import type { AgentActivityIdentity } from './agent-activity-identity'
import type { AgentContentEvidence, AgentPresenceEvidence } from '@/lib/pane-agent-evidence'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'
import type { PaneAgentLifecycle } from '@/store/slices/pane-agent-lifecycle'

export type AgentActivityWorkspaceInfo = {
  id: string
  title: string
  projectKey: string | null
  executionHostId: ExecutionHostId | null
}

export type AgentActivityKind = 'attention' | 'working' | 'idle' | 'completed'

export type AgentActivityNavigationTarget = {
  worktreeId: string
  paneKey: string
  executionHostId: ExecutionHostId
  runtimeAgent: TuiAgent | null
  normalizedVaultAgent: AiVaultAgent | null
  providerSessionId: string | null
  agentLifecycleId: string
  activityIdentity: AgentActivityIdentity
}

export type AgentActivityNavigationUnavailableReason =
  | 'host-unresolved'
  | 'pane-unavailable'
  | 'identity-ambiguous'
  | 'lifecycle-missing'
  | 'title-only-evidence'
  | 'remote-disconnected'

export type AgentActivityItem = {
  id: string
  kind: AgentActivityKind
  state: 'working' | 'blocked' | 'waiting' | 'idle' | 'done'
  paneKey: string | null
  worktreeId: string | null
  executionHostId: ExecutionHostId | null
  runtimeAgent: TuiAgent | null
  vaultAgent: AiVaultAgent | null
  title: string
  subtitle: string | null
  message: string | null
  completionMessage: string | null
  toolName: string | null
  toolInput: string | null
  interactivePrompt: string | null
  startedAt: number | null
  stateChangedAt: number
  updatedAt: number
  completedAt: number | null
  providerSessionId: string | null
  agentLifecycleId: string | null
  agentSessionStartedAt: number | null
  activityIdentity: AgentActivityIdentity | null
  matchedSession: AiVaultSession | null
  navigationTarget: AgentActivityNavigationTarget | null
  navigationUnavailableReason: AgentActivityNavigationUnavailableReason | null
}

export type AgentActivityModel = {
  attention: readonly AgentActivityItem[]
  working: readonly AgentActivityItem[]
  idle: readonly AgentActivityItem[]
  completed: readonly AgentActivityItem[]
  counts: { attention: number; working: number; idle: number; completed: number }
}

export type BuildAgentActivityArgs = {
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey: Record<string, RetainedAgentEntry>
  paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
  paneAgentLifecycleByPaneKey?: Record<string, PaneAgentLifecycle>
  tabsByWorktree: Record<string, TerminalTab[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  ptyIdsByTabId: Record<string, string[]>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey: Record<string, AgentStatusOrchestrationContext>
  sessions: readonly AiVaultSession[]
  filteredSessionIds: ReadonlySet<string>
  hasSearchQuery: boolean
  enabledVaultAgents: readonly AiVaultAgent[]
  vaultScope: AiVaultScope
  executionHostScope: ExecutionHostScope
  activeProjectKey: string | null
  workspaceScopeIds: ReadonlySet<string>
  workspaceInfoById: ReadonlyMap<string, AgentActivityWorkspaceInfo>
  now: number
}

export type AgentActivitySource = {
  paneKey: string
  entry: AgentStatusEntry
  worktreeId: string
  runtimeAgent: TuiAgent | null
  rowSource: 'live' | 'retained' | 'subagent' | 'title'
  rowState: AgentStatusState | 'idle'
  presenceEvidence: AgentPresenceEvidence | undefined
  contentEvidence: AgentContentEvidence | undefined
  foreground?: PaneForegroundAgentEntry
  lifecycle?: PaneAgentLifecycle
}
