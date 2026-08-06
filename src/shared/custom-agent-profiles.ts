import { isTuiAgent } from './tui-agent-config'
import type { CustomAgentProfile, TuiAgent } from './types'

export const MAX_CUSTOM_AGENT_PROFILES = 64
export const MAX_CUSTOM_AGENT_PROFILE_NAME_LENGTH = 80
export const MAX_CUSTOM_AGENT_PROFILE_COMMAND_LENGTH = 4096

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function normalizeProfile(value: unknown): CustomAgentProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const candidate = value as Record<string, unknown>
  const id = normalizeText(candidate.id, 128)
  const name = normalizeText(candidate.name, MAX_CUSTOM_AGENT_PROFILE_NAME_LENGTH)
  const command = normalizeText(candidate.command, MAX_CUSTOM_AGENT_PROFILE_COMMAND_LENGTH)
  const baseAgent = candidate.baseAgent
  const permissionMode = candidate.permissionMode
  if (
    !id ||
    !name ||
    !command ||
    !isTuiAgent(baseAgent) ||
    (permissionMode !== 'yolo' && permissionMode !== 'manual')
  ) {
    return null
  }
  return {
    id,
    name,
    baseAgent,
    command,
    permissionMode,
    enabled: candidate.enabled !== false
  }
}

export function normalizeCustomAgentProfiles(value: unknown): CustomAgentProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const profiles: CustomAgentProfile[] = []
  const seenIds = new Set<string>()
  for (const valueEntry of value) {
    const profile = normalizeProfile(valueEntry)
    if (!profile || seenIds.has(profile.id)) {
      continue
    }
    seenIds.add(profile.id)
    profiles.push(profile)
    if (profiles.length >= MAX_CUSTOM_AGENT_PROFILES) {
      break
    }
  }
  return profiles
}

export function isCustomAgentProfileNameAvailable(
  profiles: readonly CustomAgentProfile[],
  name: string
): boolean {
  const normalizedName = name.trim().toLocaleLowerCase()
  return (
    Boolean(normalizedName) &&
    profiles.every((profile) => profile.name.toLocaleLowerCase() !== normalizedName)
  )
}

export function getLaunchableCustomAgentProfiles(
  profiles: unknown,
  disabledAgents: readonly TuiAgent[]
): CustomAgentProfile[] {
  const disabled = new Set(disabledAgents)
  return normalizeCustomAgentProfiles(profiles).filter(
    (profile) => profile.enabled && !disabled.has(profile.baseAgent)
  )
}
