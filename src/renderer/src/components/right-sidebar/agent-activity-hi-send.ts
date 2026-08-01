import type { RuntimeTerminalSend } from '../../../../shared/runtime-types'
import { TERMINAL_AGENT_IDLE_GUARD_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { toAiVaultAgent } from '../../../../shared/ai-vault-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  BRACKETED_PASTE_BEGIN,
  BRACKETED_PASTE_END,
  POST_PASTE_SUBMIT_DELAY_MS,
  sanitizeBracketedPasteContent
} from '@/lib/agent-paste-draft'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/ai-vault-resume-target'
import {
  isRuntimeTerminalNotWritable,
  isRuntimeTerminalUnavailable
} from '@/lib/active-agent-terminal-send-readiness'
import { findActiveRuntimeTerminal } from '@/lib/active-agent-note-target'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  runtimeEnvironmentSupportsCapability
} from '@/runtime/runtime-rpc-client'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { useAppStore } from '@/store'
import type { AgentActivityItem } from './agent-activity-types'

const HI_PROMPT = 'hi'
const HI_SEND_TIMEOUT_MS = 15_000
const DESKTOP_TERMINAL_CLIENT = { id: 'orca-desktop', type: 'desktop' as const }

export type AgentActivityHiSendResult =
  | 'sent'
  | 'agent-changed'
  | 'terminal-unavailable'
  | 'not-idle'
  | 'permission'
  | 'status-unavailable'
  | 'runtime-unavailable'
  | 'not-writable'
  | 'partial-submit-failed'

function targetMatchesCurrentAgent(item: AgentActivityItem): boolean {
  const target = item.navigationTarget
  if (item.kind !== 'idle' || !target?.ptyId) {
    return false
  }
  const state = useAppStore.getState()
  if (
    getAiVaultResumeWorkspaceExecutionHostId(state, target.worktreeId) !== target.executionHostId
  ) {
    return false
  }
  const lifecycle = state.paneAgentLifecycleByPaneKey[target.paneKey]
  if (
    !lifecycle ||
    lifecycle.id !== target.agentLifecycleId ||
    lifecycle.executionHostId !== target.executionHostId ||
    lifecycle.phase !== 'active' ||
    lifecycle.ptyId !== target.ptyId ||
    toAiVaultAgent(lifecycle.runtimeAgent) !== target.normalizedVaultAgent
  ) {
    return false
  }
  if (!target.providerSessionId) {
    return true
  }
  const entry = state.agentStatusByPaneKey[target.paneKey]
  return Boolean(
    entry &&
    entry.executionHostId === target.executionHostId &&
    entry.agentLifecycleId === target.agentLifecycleId &&
    entry.providerSession?.id === target.providerSessionId &&
    toAiVaultAgent(entry.agentType) === target.normalizedVaultAgent
  )
}

function terminalMatchesTarget(
  terminal: Awaited<ReturnType<typeof findActiveRuntimeTerminal>>,
  item: AgentActivityItem,
  runtimeTarget: ReturnType<typeof getActiveRuntimeTarget>
): boolean {
  const expectedPtyId = item.navigationTarget?.ptyId
  if (!terminal || !expectedPtyId || !terminal.connected || !terminal.writable) {
    return false
  }
  if (runtimeTarget.kind === 'local') {
    return terminal.ptyId === expectedPtyId
  }
  const remotePty = parseRemoteRuntimePtyId(expectedPtyId)
  return Boolean(
    remotePty &&
    remotePty.handle === terminal.handle &&
    (!remotePty.environmentId || remotePty.environmentId === runtimeTarget.environmentId)
  )
}

function refusedResult(
  send: RuntimeTerminalSend,
  partial: boolean
): AgentActivityHiSendResult | null {
  if (send.accepted) {
    return null
  }
  if (partial) {
    return 'partial-submit-failed'
  }
  switch (send.refusedReason) {
    case 'permission':
      return 'permission'
    case 'not-idle':
      return 'not-idle'
    case 'no-agent':
      return 'agent-changed'
    case undefined:
      return 'not-writable'
  }
}

export async function sendHiToAgentActivity(
  item: AgentActivityItem
): Promise<AgentActivityHiSendResult> {
  const target = item.navigationTarget
  const pane = target ? parsePaneKey(target.paneKey) : null
  if (!target || !pane || !targetMatchesCurrentAgent(item)) {
    return 'agent-changed'
  }
  const state = useAppStore.getState()
  const runtimeTarget = getActiveRuntimeTarget(
    getSettingsForWorktreeRuntimeOwner(state, target.worktreeId)
  )
  if (runtimeTarget.kind === 'environment') {
    try {
      if (
        !(await runtimeEnvironmentSupportsCapability(
          runtimeTarget.environmentId,
          TERMINAL_AGENT_IDLE_GUARD_RUNTIME_CAPABILITY
        ))
      ) {
        return 'status-unavailable'
      }
    } catch {
      return 'runtime-unavailable'
    }
  }

  let terminal
  try {
    terminal = await findActiveRuntimeTerminal(
      runtimeTarget,
      target.worktreeId,
      { tabId: pane.tabId, leafId: pane.leafId },
      HI_SEND_TIMEOUT_MS
    )
  } catch (error) {
    if (isRuntimeTerminalUnavailable(error)) {
      return 'terminal-unavailable'
    }
    return 'runtime-unavailable'
  }
  if (!terminalMatchesTarget(terminal, item, runtimeTarget)) {
    return terminal ? 'agent-changed' : 'terminal-unavailable'
  }

  const payload = `${BRACKETED_PASTE_BEGIN}${sanitizeBracketedPasteContent(HI_PROMPT)}${BRACKETED_PASTE_END}`
  try {
    const { send: paste } = await callRuntimeRpc<{ send: RuntimeTerminalSend }>(
      runtimeTarget,
      'terminal.send',
      {
        terminal: terminal.handle,
        text: payload,
        requireAgentStatus: 'idle',
        client: DESKTOP_TERMINAL_CLIENT
      },
      { timeoutMs: HI_SEND_TIMEOUT_MS }
    )
    const pasteFailure = refusedResult(paste, false)
    if (pasteFailure) {
      return pasteFailure
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POST_PASTE_SUBMIT_DELAY_MS))
    if (!targetMatchesCurrentAgent(item)) {
      return 'partial-submit-failed'
    }
    const { send: submit } = await callRuntimeRpc<{ send: RuntimeTerminalSend }>(
      runtimeTarget,
      'terminal.send',
      {
        terminal: terminal.handle,
        enter: true,
        requireAgentStatus: 'idle',
        client: DESKTOP_TERMINAL_CLIENT
      },
      { timeoutMs: HI_SEND_TIMEOUT_MS }
    )
    return refusedResult(submit, true) ?? 'sent'
  } catch (error) {
    if (isRuntimeTerminalUnavailable(error)) {
      return 'terminal-unavailable'
    }
    if (isRuntimeTerminalNotWritable(error)) {
      return 'not-writable'
    }
    return 'runtime-unavailable'
  }
}
