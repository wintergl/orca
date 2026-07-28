import type { TuiAgent } from './types'

export const CODEX_WRAPPER_AGENTS = ['codexdb', 'codexdba'] as const satisfies readonly TuiAgent[]

export type CodexWrapperAgent = (typeof CODEX_WRAPPER_AGENTS)[number]
export type CodexRuntimeAgent = 'codex' | CodexWrapperAgent

const CODEX_WRAPPER_AGENT_SET: ReadonlySet<string> = new Set(CODEX_WRAPPER_AGENTS)

export function isCodexWrapperAgentType(
  agent: string | null | undefined
): agent is CodexWrapperAgent {
  return typeof agent === 'string' && CODEX_WRAPPER_AGENT_SET.has(agent)
}

export function isCodexRuntimeAgentType(
  agent: string | null | undefined
): agent is CodexRuntimeAgent {
  return agent === 'codex' || isCodexWrapperAgentType(agent)
}
