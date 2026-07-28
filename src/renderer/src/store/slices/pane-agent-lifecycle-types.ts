import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { TuiAgent } from '../../../../shared/types'

export type PaneAgentTransportPhase = 'active' | 'transport-disconnected'

export type PaneAgentLifecycle = {
  id: string
  startedAt: number
  paneKey: string
  executionHostId: ExecutionHostId
  connectionId: string | null
  ptyId: string | null
  runtimeAgent: TuiAgent | null
  providerSessionId: string | null
  launchToken: string | null
  phase: PaneAgentTransportPhase
  authorityRevision: number
}

type PaneAgentLifecycleObservation = {
  paneKey: string
  executionHostId: ExecutionHostId
  connectionId?: string | null
  ptyId?: string | null
  runtimeAgent?: TuiAgent | null
  providerSessionId?: string | null
  launchToken?: string | null
  observedAt?: number
  authorityRevision?: number
  authorityLifecycleId?: string
}

type PaneAgentLifecycleDestructiveAuthority = {
  paneKey: string
  authorityLifecycleId: string
  authorityRevision: number
  observedAt: number
}

export type ObservePaneAgentLifecycleInput = PaneAgentLifecycleObservation & {
  runtimeAgent: TuiAgent | null
}

export type PaneAgentLifecycleEvent =
  | ({ type: 'agent-observed' } & PaneAgentLifecycleObservation)
  | ({ type: 'provider-session-observed' } & PaneAgentLifecycleObservation)
  | ({ type: 'launch-token-observed' } & PaneAgentLifecycleObservation)
  | ({ type: 'pty-bound' | 'pty-replaced' } & PaneAgentLifecycleObservation)
  | ({ type: 'foreground-agent-observed' } & PaneAgentLifecycleObservation)
  | ({ type: 'foreground-inconclusive' } & Pick<
      PaneAgentLifecycleObservation,
      'paneKey' | 'observedAt' | 'authorityRevision'
    >)
  | ({ type: 'shell-confirmed' | 'pane-retired' } & PaneAgentLifecycleDestructiveAuthority)
  | ({ type: 'transport-disconnected' } & PaneAgentLifecycleDestructiveAuthority & {
        connectionId: string
      })
  | ({ type: 'transport-reattached' } & PaneAgentLifecycleObservation)
  | {
      type: 'authority-transferred'
      fromPaneKey: string
      toPaneKey: string
      executionHostId: ExecutionHostId
      ptyId: string
      sourceLifecycleId: string
      sourceAuthorityRevision: number
      authorityRevision: number
      observedAt: number
    }

export type PaneAgentLifecycleSlice = {
  paneAgentLifecycleByPaneKey: Record<string, PaneAgentLifecycle>
  dispatchPaneAgentLifecycleEvent: (event: PaneAgentLifecycleEvent) => PaneAgentLifecycle | null
  observePaneAgentLifecycle: (input: ObservePaneAgentLifecycleInput) => PaneAgentLifecycle | null
  retirePaneAgentLifecycle: (paneKey: string) => void
  transferPaneAgentLifecycle: (fromPaneKey: string, toPaneKey: string) => void
  markPaneAgentLifecyclesTransportDisconnected: (connectionId: string) => void
  clearPaneAgentLifecyclesByTabPrefix: (tabId: string) => void
}

export type { PaneAgentLifecycleObservation }
