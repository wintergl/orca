import { getAgentLabel } from './agent-detection'
import { resolveCompatibleAgentTypeForOwner } from './agent-title-owner'
import type { AgentType } from './agent-status-types'
import type { TuiAgent } from './types'

const TITLE_AGENT_LABEL_TO_RUNTIME_AGENT: Record<string, TuiAgent> = {
  'Claude Code': 'claude',
  OpenClaude: 'openclaude',
  Codex: 'codex',
  'Codex (Doubao Coding)': 'codexdb',
  'Codex (Doubao Agent)': 'codexdba',
  'Gemini CLI': 'gemini',
  'GitHub Copilot': 'copilot',
  Grok: 'grok',
  Devin: 'devin',
  Antigravity: 'antigravity',
  OpenCode: 'opencode',
  'MiMo Code': 'mimo-code',
  Aider: 'aider',
  Cursor: 'cursor',
  Droid: 'droid',
  Hermes: 'hermes',
  Pi: 'pi',
  OMP: 'omp'
}

export function resolveRuntimeAgentForTitleLabel(
  label: string | null | undefined
): TuiAgent | null {
  return label ? (TITLE_AGENT_LABEL_TO_RUNTIME_AGENT[label] ?? null) : null
}

export function resolveRuntimeAgentFromTitle(
  title: string,
  ownerAgentType?: AgentType | null
): TuiAgent | null {
  const titleAgent = resolveRuntimeAgentForTitleLabel(getAgentLabel(title))
  if (!titleAgent) {
    return null
  }
  return (resolveCompatibleAgentTypeForOwner(titleAgent, ownerAgentType ?? null) ??
    titleAgent) as TuiAgent
}
