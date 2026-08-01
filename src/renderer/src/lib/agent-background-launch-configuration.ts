import type { GlobalSettings, TuiAgent } from '../../../shared/types'
import type { AgentPermissionMode } from '../../../shared/tui-agent-permissions'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { resolveTuiAgentPermissionLaunch } from '../../../shared/tui-agent-permissions'

export function resolveAgentBackgroundLaunchConfiguration(args: {
  agent: TuiAgent
  agentCommand?: string
  permissionMode?: Exclude<AgentPermissionMode, 'mixed'>
  settings: GlobalSettings | null | undefined
}): {
  agentCommand?: string
  permissionMode?: Exclude<AgentPermissionMode, 'mixed'>
  cmdOverrides: Partial<Record<TuiAgent, string>>
  agentArgs: string
  agentEnv: Record<string, string>
} {
  const configuredAgentArgs = resolveTuiAgentLaunchArgs(args.agent, args.settings?.agentDefaultArgs)
  const configuredAgentEnv = resolveTuiAgentLaunchEnv(args.agent, args.settings?.agentDefaultEnv)
  const permissionLaunch = args.permissionMode
    ? resolveTuiAgentPermissionLaunch({
        agent: args.agent,
        mode: args.permissionMode,
        agentArgs: configuredAgentArgs,
        agentEnv: configuredAgentEnv
      })
    : null
  const agentCommand = args.agentCommand?.trim() || undefined
  return {
    ...(agentCommand ? { agentCommand } : {}),
    ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
    cmdOverrides: agentCommand
      ? { ...args.settings?.agentCmdOverrides, [args.agent]: agentCommand }
      : (args.settings?.agentCmdOverrides ?? {}),
    agentArgs: permissionLaunch?.agentArgs ?? configuredAgentArgs,
    agentEnv: permissionLaunch?.agentEnv ?? configuredAgentEnv
  }
}
