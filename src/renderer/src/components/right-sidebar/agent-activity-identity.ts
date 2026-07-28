import type { AiVaultAgent } from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { TuiAgent } from '../../../../shared/types'

export type AgentActivityIdentity = {
  canonicalKey: string
  aliases: ReadonlySet<string>
}

type IdentityComponent = string | number | null | undefined

function encodeComponent(value: IdentityComponent): string {
  const normalized = value === null || value === undefined ? '' : String(value)
  if (normalized.includes('\0')) {
    throw new Error('Agent activity identity components cannot contain NUL.')
  }
  return normalized
}

export function encodeAgentActivityIdentityTuple(
  kind: 'provider' | 'lifecycle',
  components: readonly IdentityComponent[]
): string {
  return ['v1', kind, ...components.map(encodeComponent)].join('\0')
}

export function buildProviderActivityKey(args: {
  executionHostId: ExecutionHostId
  vaultAgent: AiVaultAgent
  providerSessionId: string
}): string {
  return encodeAgentActivityIdentityTuple('provider', [
    args.executionHostId,
    args.vaultAgent,
    args.providerSessionId
  ])
}

export function buildLifecycleActivityKey(args: {
  executionHostId: ExecutionHostId
  worktreeId: string
  paneKey: string
  runtimeAgent: TuiAgent | null
  lifecycleId: string
}): string {
  return encodeAgentActivityIdentityTuple('lifecycle', [
    args.executionHostId,
    args.worktreeId,
    args.paneKey,
    args.runtimeAgent,
    args.lifecycleId
  ])
}

export function buildAgentActivityIdentity(args: {
  executionHostId: ExecutionHostId
  worktreeId: string
  paneKey: string
  runtimeAgent: TuiAgent | null
  vaultAgent: AiVaultAgent | null
  providerSessionId: string | null
  lifecycleId: string | null
}): AgentActivityIdentity | null {
  const lifecycleKey = args.lifecycleId
    ? buildLifecycleActivityKey({
        executionHostId: args.executionHostId,
        worktreeId: args.worktreeId,
        paneKey: args.paneKey,
        runtimeAgent: args.runtimeAgent,
        lifecycleId: args.lifecycleId
      })
    : null
  const providerKey =
    args.providerSessionId && args.vaultAgent
      ? buildProviderActivityKey({
          executionHostId: args.executionHostId,
          vaultAgent: args.vaultAgent,
          providerSessionId: args.providerSessionId
        })
      : null
  const canonicalKey = providerKey ?? lifecycleKey
  if (!canonicalKey) {
    return null
  }
  const aliases = new Set<string>([canonicalKey])
  if (lifecycleKey) {
    aliases.add(lifecycleKey)
  }
  return { canonicalKey, aliases }
}

export function agentActivityIdentitiesIntersect(
  left: AgentActivityIdentity | null,
  right: AgentActivityIdentity | null
): boolean {
  if (!left || !right) {
    return false
  }
  const [small, large] =
    left.aliases.size <= right.aliases.size
      ? [left.aliases, right.aliases]
      : [right.aliases, left.aliases]
  for (const key of small) {
    if (large.has(key)) {
      return true
    }
  }
  return false
}

export function encodeAgentActivityDisplayId(components: readonly IdentityComponent[]): string {
  return JSON.stringify(components.map((component) => (component ?? '').toString()))
}
