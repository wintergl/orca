import type { TuiAgent } from '../../../shared/types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'

export type LaunchAgentInNewTabArgs = {
  agent: TuiAgent
  worktreeId: string
  groupId?: string
  prompt?: string
  agentArgs?: string | null
  agentCommand?: string
  permissionMode?: 'yolo' | 'manual'
  title?: string
  initialCwd?: string | null
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  launchSource?: LaunchSource
  quickCommandLabel?: string | null
  launchPlatform?: NodeJS.Platform
  onPromptDelivered?: () => void
}

export type LaunchAgentInNewTabResult = {
  tabId: string | null
  startupPlan: AgentStartupPlan
  pasteDraftAfterLaunch: boolean
  promptDeliveryResult?: Promise<{ delivered: boolean; failureNotified: boolean }>
} | null
