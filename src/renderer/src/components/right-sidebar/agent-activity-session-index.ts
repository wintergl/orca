import type { AiVaultAgent, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  buildProviderActivityKey,
  encodeAgentActivityIdentityTuple
} from './agent-activity-identity'

export function buildAgentActivityProviderKey(args: {
  executionHostId: ExecutionHostId
  vaultAgent: AiVaultAgent
  providerSessionId: string
}): string {
  return buildProviderActivityKey(args)
}

export function buildAgentActivityProviderAgentKey(args: {
  executionHostId: ExecutionHostId
  vaultAgent: AiVaultAgent
}): string {
  return encodeAgentActivityIdentityTuple('provider', [args.executionHostId, args.vaultAgent])
}

export function indexAgentActivitySessions(
  sessions: readonly AiVaultSession[]
): ReadonlyMap<string, AiVaultSession> {
  const index = new Map<string, AiVaultSession>()
  for (const session of sessions) {
    index.set(
      buildAgentActivityProviderKey({
        executionHostId: session.executionHostId,
        vaultAgent: session.agent,
        providerSessionId: session.sessionId
      }),
      session
    )
  }
  return index
}
