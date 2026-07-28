import type { PaneAgentLifecycle } from './pane-agent-lifecycle-types'

export function markPaneAgentLifecyclesTransportDisconnected(
  lifecycles: Record<string, PaneAgentLifecycle>,
  connectionId: string
): Record<string, PaneAgentLifecycle> {
  let next: Record<string, PaneAgentLifecycle> | null = null
  for (const [paneKey, lifecycle] of Object.entries(lifecycles)) {
    if (lifecycle.connectionId !== connectionId || lifecycle.phase === 'transport-disconnected') {
      continue
    }
    next ??= { ...lifecycles }
    next[paneKey] = {
      ...lifecycle,
      phase: 'transport-disconnected',
      authorityRevision: lifecycle.authorityRevision + 1
    }
  }
  return next ?? lifecycles
}
