import type { AgentStatusState } from '../../../../shared/agent-status-types'
import {
  aiVaultAgentMatchesRuntimeAgent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import { promptsMatchSession } from './ai-vault-original-pane-prompt-match'
import {
  candidateMatchesSessionHost,
  paneHasCurrentLiveAuthority,
  resolveOriginalPaneTarget,
  type AiVaultOriginalPaneTarget,
  type OriginalPaneState
} from './ai-vault-original-pane-target'

export {
  originalPaneTargetMatchesCurrentAuthority,
  paneHasCurrentLiveAuthority,
  paneHasDifferentLiveOccupant,
  resolveOriginalPaneCandidateExecutionHostId,
  resolveOriginalPaneTarget,
  type AiVaultOriginalPaneTarget,
  type OriginalPaneState
} from './ai-vault-original-pane-target'

function agentMatches(session: AiVaultSession, agent: string | undefined): boolean {
  return aiVaultAgentMatchesRuntimeAgent(session, agent)
}

function providerSessionMatches(session: AiVaultSession, providerSessionId: string | undefined) {
  return providerSessionId === session.sessionId
}

/**
 * The hook-reported live state of the agent currently running this session,
 * or null when the session is not live in any pane. Matches by provider
 * session id first; falls back to a prompt match only when it is unambiguous.
 */
export function findAiVaultSessionLiveState(
  state: OriginalPaneState,
  session: AiVaultSession
): AgentStatusState | null {
  const promptMatchedStates: AgentStatusState[] = []

  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    if (
      !agentMatches(session, entry.agentType) ||
      !candidateMatchesSessionHost({
        state,
        session,
        worktreeId: entry.worktreeId,
        executionHostId: entry.executionHostId
      })
    ) {
      continue
    }
    if (providerSessionMatches(session, entry.providerSession?.id)) {
      return entry.state
    }
    if (entry.providerSession === undefined && promptsMatchSession(session, entry)) {
      promptMatchedStates.push(entry.state)
    }
  }

  return promptMatchedStates.length === 1 ? promptMatchedStates[0] : null
}

export function findOriginalAiVaultSessionPane(
  state: OriginalPaneState,
  session: AiVaultSession
): AiVaultOriginalPaneTarget | null {
  const promptMatchedTargets: AiVaultOriginalPaneTarget[] = []

  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    if (
      agentMatches(session, entry.agentType) &&
      providerSessionMatches(session, entry.providerSession?.id) &&
      candidateMatchesSessionHost({
        state,
        session,
        worktreeId: entry.worktreeId,
        executionHostId: entry.executionHostId
      })
    ) {
      const target = resolveOriginalPaneTarget({
        state,
        session,
        paneKey: entry.paneKey,
        worktreeIdHint: entry.worktreeId,
        tabIdHint: entry.tabId
      })
      if (target) {
        return target
      }
    }
    if (
      agentMatches(session, entry.agentType) &&
      entry.providerSession === undefined &&
      candidateMatchesSessionHost({
        state,
        session,
        worktreeId: entry.worktreeId,
        executionHostId: entry.executionHostId
      }) &&
      promptsMatchSession(session, entry)
    ) {
      const target = resolveOriginalPaneTarget({
        state,
        session,
        paneKey: entry.paneKey,
        worktreeIdHint: entry.worktreeId,
        tabIdHint: entry.tabId
      })
      if (target) {
        promptMatchedTargets.push(target)
      }
    }
  }

  for (const retained of Object.values(state.retainedAgentsByPaneKey)) {
    if (
      agentMatches(session, retained.agentType) &&
      providerSessionMatches(session, retained.entry.providerSession?.id) &&
      candidateMatchesSessionHost({
        state,
        session,
        worktreeId: retained.worktreeId,
        executionHostId: retained.entry.executionHostId
      })
    ) {
      if (!paneHasCurrentLiveAuthority(state, session, retained.entry.paneKey)) {
        continue
      }
      const target = resolveOriginalPaneTarget({
        state,
        session,
        paneKey: retained.entry.paneKey,
        worktreeIdHint: retained.worktreeId,
        tabIdHint: retained.entry.tabId ?? retained.tab.id
      })
      if (target) {
        return target
      }
    }
    if (
      agentMatches(session, retained.agentType) &&
      retained.entry.providerSession === undefined &&
      candidateMatchesSessionHost({
        state,
        session,
        worktreeId: retained.worktreeId,
        executionHostId: retained.entry.executionHostId
      }) &&
      promptsMatchSession(session, retained.entry)
    ) {
      if (!paneHasCurrentLiveAuthority(state, session, retained.entry.paneKey)) {
        continue
      }
      const target = resolveOriginalPaneTarget({
        state,
        session,
        paneKey: retained.entry.paneKey,
        worktreeIdHint: retained.worktreeId,
        tabIdHint: retained.entry.tabId ?? retained.tab.id
      })
      if (target) {
        promptMatchedTargets.push(target)
      }
    }
  }

  for (const record of Object.values(state.sleepingAgentSessionsByPaneKey)) {
    if (
      agentMatches(session, record.agent) &&
      providerSessionMatches(session, record.providerSession.id) &&
      candidateMatchesSessionHost({ state, session, worktreeId: record.worktreeId })
    ) {
      if (!paneHasCurrentLiveAuthority(state, session, record.paneKey)) {
        continue
      }
      const target = resolveOriginalPaneTarget({
        state,
        session,
        paneKey: record.paneKey,
        worktreeIdHint: record.worktreeId,
        tabIdHint: record.tabId
      })
      if (target) {
        return target
      }
    }
  }

  return promptMatchedTargets.length === 1 ? promptMatchedTargets[0] : null
}
