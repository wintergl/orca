import { describe, expect, it } from 'vitest'
import {
  buildAgentActivityIdentity,
  buildProviderActivityKey,
  encodeAgentActivityIdentityTuple
} from './agent-activity-identity'

describe('agent activity identity', () => {
  it('keeps same provider sessions on different hosts distinct', () => {
    expect(
      buildProviderActivityKey({
        executionHostId: 'local',
        vaultAgent: 'codex',
        providerSessionId: 'session-1'
      })
    ).not.toBe(
      buildProviderActivityKey({
        executionHostId: 'ssh:worker-a',
        vaultAgent: 'codex',
        providerSessionId: 'session-1'
      })
    )
  })

  it('uses a provider identity as canonical while preserving lifecycle as an alias', () => {
    const identity = buildAgentActivityIdentity({
      executionHostId: 'local',
      worktreeId: 'wt-1',
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      runtimeAgent: 'codex',
      vaultAgent: 'codex',
      providerSessionId: 'session-1',
      lifecycleId: 'lifecycle-1'
    })

    expect(identity?.aliases.size).toBe(2)
    expect(identity?.canonicalKey).toContain('provider')
  })

  it('rejects identity components that could corrupt the tuple encoding', () => {
    expect(() => encodeAgentActivityIdentityTuple('provider', ['invalid\0session'])).toThrow(
      'cannot contain NUL'
    )
  })
})
