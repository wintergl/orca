import { describe, expect, it } from 'vitest'
import {
  getLaunchableCustomAgentProfiles,
  isCustomAgentProfileNameAvailable,
  MAX_CUSTOM_AGENT_PROFILES,
  normalizeCustomAgentProfiles
} from './custom-agent-profiles'

describe('custom agent profiles', () => {
  it('normalizes persisted profiles and drops malformed or duplicate records', () => {
    expect(
      normalizeCustomAgentProfiles([
        {
          id: 'custom-agent-1',
          name: ' Codex DBA ',
          baseAgent: 'codex',
          command: ' codexdba ',
          permissionMode: 'yolo'
        },
        {
          id: 'custom-agent-1',
          name: 'Duplicate',
          baseAgent: 'codex',
          command: 'codex',
          permissionMode: 'manual'
        },
        { id: 'bad', name: 'Bad', baseAgent: 'unknown', command: 'bad' }
      ])
    ).toEqual([
      {
        id: 'custom-agent-1',
        name: 'Codex DBA',
        baseAgent: 'codex',
        command: 'codexdba',
        permissionMode: 'yolo',
        enabled: true
      }
    ])
  })

  it('bounds the saved collection', () => {
    const profiles = Array.from({ length: MAX_CUSTOM_AGENT_PROFILES + 5 }, (_, index) => ({
      id: `custom-agent-${index}`,
      name: `Agent ${index}`,
      baseAgent: 'codex',
      command: `codex-${index}`,
      permissionMode: 'manual'
    }))

    expect(normalizeCustomAgentProfiles(profiles)).toHaveLength(MAX_CUSTOM_AGENT_PROFILES)
  })

  it('checks names case-insensitively', () => {
    const profiles = normalizeCustomAgentProfiles([
      {
        id: 'custom-agent-1',
        name: 'Codex DBA',
        baseAgent: 'codex',
        command: 'codexdba',
        permissionMode: 'manual'
      }
    ])

    expect(isCustomAgentProfileNameAvailable(profiles, ' codex dba ')).toBe(false)
    expect(isCustomAgentProfileNameAvailable(profiles, 'Codex Review')).toBe(true)
  })

  it('keeps enabled custom commands launchable without PATH detection', () => {
    const profiles = [
      {
        id: 'custom-agent-1',
        name: 'Codex DBA',
        baseAgent: 'codex' as const,
        command: 'codexdba',
        permissionMode: 'manual' as const,
        enabled: true
      }
    ]

    expect(getLaunchableCustomAgentProfiles(profiles, [])).toEqual(profiles)
    expect(getLaunchableCustomAgentProfiles(profiles, ['codex'])).toEqual([])
  })
})
