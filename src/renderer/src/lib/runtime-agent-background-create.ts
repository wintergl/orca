import type { SleepingAgentLaunchConfig } from '../../../shared/agent-session-resume'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type { SessionOptionValue } from '../../../shared/native-chat-session-options'
import type { RuntimeTerminalCreate } from '../../../shared/runtime-types'
import type { TuiAgent } from '../../../shared/types'
import type { AgentPermissionMode } from '../../../shared/tui-agent-permissions'
import {
  AGENT_SESSION_CUSTOM_TITLE_RUNTIME_CAPABILITY,
  AGENT_SESSION_LAUNCH_OVERRIDES_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import {
  createAgentSessionCreateOperation,
  toAgentLaunchPreferences,
  withAgentSessionCreateOperationId
} from '@/runtime/agent-session-create-operation'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { runRemoteAgentSessionLaunch } from '@/runtime/remote-agent-session-launch'

export async function createRuntimeAgentBackgroundTerminal(args: {
  environmentId: string
  worktreeId: string
  tabId: string
  leafId: string
  agent: TuiAgent
  agentCommand?: string
  permissionMode?: Exclude<AgentPermissionMode, 'mixed'>
  prompt?: string
  sessionOptions?: Record<string, SessionOptionValue>
  legacy: {
    command: string
    env: Record<string, string>
    startupCommandDelivery?: StartupCommandDelivery
    launchConfig: SleepingAgentLaunchConfig
    launchToken: string
    title?: string
  }
}): Promise<{ terminal: RuntimeTerminalCreate }> {
  const operation = createAgentSessionCreateOperation()
  const launchPreferences = toAgentLaunchPreferences(args.sessionOptions)
  return await runRemoteAgentSessionLaunch({
    environmentId: args.environmentId,
    ...(args.legacy.title
      ? { hostAuthorityCapability: AGENT_SESSION_CUSTOM_TITLE_RUNTIME_CAPABILITY }
      : args.agentCommand || args.permissionMode
        ? { hostAuthorityCapability: AGENT_SESSION_LAUNCH_OVERRIDES_RUNTIME_CAPABILITY }
        : {}),
    hostAuthority: () =>
      operation.run((clientOperationId) =>
        callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
          { kind: 'environment', environmentId: args.environmentId },
          'terminal.createAgentSession',
          withAgentSessionCreateOperationId(
            {
              worktree: toRuntimeWorktreeSelector(args.worktreeId),
              agent: args.agent,
              ...(args.agentCommand ? { agentCommand: args.agentCommand } : {}),
              ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
              ...(args.legacy.title ? { title: args.legacy.title } : {}),
              ...(args.prompt
                ? { prompt: args.prompt, promptDelivery: 'auto-submit' as const }
                : {}),
              ...(launchPreferences ? { launchPreferences } : {}),
              placement: { tabId: args.tabId, leafId: args.leafId },
              // Why: local renderer owns the hidden tab; remote runtime should not reveal UI.
              presentation: 'background'
            },
            clientOperationId
          ),
          { timeoutMs: 15_000 }
        )
      ),
    legacy: ({ skipCompatibilityCheck }) =>
      callRuntimeRpc<{ terminal: RuntimeTerminalCreate }>(
        { kind: 'environment', environmentId: args.environmentId },
        'terminal.create',
        {
          worktree: toRuntimeWorktreeSelector(args.worktreeId),
          command: args.legacy.command,
          ...(args.legacy.startupCommandDelivery
            ? { startupCommandDelivery: args.legacy.startupCommandDelivery }
            : {}),
          env: args.legacy.env,
          launchConfig: args.legacy.launchConfig,
          launchToken: args.legacy.launchToken,
          launchAgent: args.agent,
          ...(args.legacy.title ? { title: args.legacy.title } : {}),
          tabId: args.tabId,
          leafId: args.leafId,
          presentation: 'background'
        },
        { timeoutMs: 15_000, skipCompatibilityCheck }
      )
  })
}
