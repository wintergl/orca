import type { StateCreator } from 'zustand'
import type { TuiAgent } from '../../../../shared/types'
import type { AppState } from '../types'
import type {
  PaneAgentLifecycle,
  PaneAgentLifecycleEvent,
  PaneAgentLifecycleSlice,
  PaneAgentLifecycleObservation,
  PaneAgentTransportPhase
} from './pane-agent-lifecycle-types'
import { markPaneAgentLifecyclesTransportDisconnected } from './pane-agent-transport-disconnect'

export type {
  ObservePaneAgentLifecycleInput,
  PaneAgentLifecycle,
  PaneAgentLifecycleEvent,
  PaneAgentLifecycleSlice,
  PaneAgentTransportPhase
} from './pane-agent-lifecycle-types'

function createLifecycleId(): string {
  const id = globalThis.crypto?.randomUUID?.()
  if (!id) {
    throw new Error('Agent lifecycle identity requires crypto.randomUUID().')
  }
  return id
}

function normalizedValue(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function compatibleAgent(current: TuiAgent | null, next: TuiAgent | null | undefined): boolean {
  return current === null || next === null || next === undefined || current === next
}

function compatibleKnownValue(current: string | null, next: string | null | undefined): boolean {
  return current === null || next === null || next === undefined || current === next
}

function hasCompatibleAuthority(
  current: PaneAgentLifecycle,
  input: PaneAgentLifecycleObservation
): boolean {
  return (
    current.executionHostId === input.executionHostId &&
    compatibleKnownValue(current.connectionId, normalizedValue(input.connectionId)) &&
    compatibleKnownValue(current.ptyId, normalizedValue(input.ptyId)) &&
    compatibleAgent(current.runtimeAgent, input.runtimeAgent) &&
    compatibleKnownValue(current.providerSessionId, normalizedValue(input.providerSessionId)) &&
    compatibleKnownValue(current.launchToken, normalizedValue(input.launchToken))
  )
}

function canReattach(current: PaneAgentLifecycle, input: PaneAgentLifecycleObservation): boolean {
  const connectionId = normalizedValue(input.connectionId)
  const ptyId = normalizedValue(input.ptyId)
  return (
    current.executionHostId === input.executionHostId &&
    current.connectionId !== null &&
    current.connectionId === connectionId &&
    current.ptyId !== null &&
    current.ptyId === ptyId &&
    compatibleAgent(current.runtimeAgent, input.runtimeAgent) &&
    compatibleKnownValue(current.providerSessionId, normalizedValue(input.providerSessionId)) &&
    compatibleKnownValue(current.launchToken, normalizedValue(input.launchToken))
  )
}

function lifecycleFromObservation(
  input: PaneAgentLifecycleObservation,
  observedAt: number
): PaneAgentLifecycle {
  return {
    id: createLifecycleId(),
    startedAt: observedAt,
    paneKey: input.paneKey,
    executionHostId: input.executionHostId,
    connectionId: normalizedValue(input.connectionId),
    ptyId: normalizedValue(input.ptyId),
    runtimeAgent: input.runtimeAgent ?? null,
    providerSessionId: normalizedValue(input.providerSessionId),
    launchToken: normalizedValue(input.launchToken),
    phase: 'active',
    authorityRevision: input.authorityRevision ?? 0
  }
}

function mergeObservation(
  current: PaneAgentLifecycle,
  input: PaneAgentLifecycleObservation,
  phase: PaneAgentTransportPhase = 'active'
): PaneAgentLifecycle {
  return {
    ...current,
    connectionId: current.connectionId ?? normalizedValue(input.connectionId),
    ptyId: current.ptyId ?? normalizedValue(input.ptyId),
    runtimeAgent: current.runtimeAgent ?? input.runtimeAgent ?? null,
    providerSessionId: current.providerSessionId ?? normalizedValue(input.providerSessionId),
    launchToken: current.launchToken ?? normalizedValue(input.launchToken),
    phase,
    authorityRevision: Math.max(current.authorityRevision, input.authorityRevision ?? 0)
  }
}

function lifecycleEquals(left: PaneAgentLifecycle, right: PaneAgentLifecycle): boolean {
  return (
    left.id === right.id &&
    left.startedAt === right.startedAt &&
    left.paneKey === right.paneKey &&
    left.executionHostId === right.executionHostId &&
    left.connectionId === right.connectionId &&
    left.ptyId === right.ptyId &&
    left.runtimeAgent === right.runtimeAgent &&
    left.providerSessionId === right.providerSessionId &&
    left.launchToken === right.launchToken &&
    left.phase === right.phase &&
    left.authorityRevision === right.authorityRevision
  )
}

function shouldIgnoreLateEvent(
  current: PaneAgentLifecycle | undefined,
  event: PaneAgentLifecycleEvent
): boolean {
  if (!current) {
    return false
  }
  if ('authorityLifecycleId' in event && event.authorityLifecycleId) {
    return (
      current.id !== event.authorityLifecycleId ||
      current.authorityRevision !== event.authorityRevision
    )
  }
  return (
    event.authorityRevision !== undefined && event.authorityRevision < current.authorityRevision
  )
}

function eventObservation(event: PaneAgentLifecycleEvent): PaneAgentLifecycleObservation | null {
  return 'paneKey' in event && 'executionHostId' in event ? event : null
}

export const createPaneAgentLifecycleSlice: StateCreator<
  AppState,
  [],
  [],
  PaneAgentLifecycleSlice
> = (set, get) => ({
  paneAgentLifecycleByPaneKey: {},

  dispatchPaneAgentLifecycleEvent: (event) => {
    if (event.type === 'authority-transferred') {
      const current = get().paneAgentLifecycleByPaneKey[event.fromPaneKey]
      if (
        !current ||
        current.id !== event.sourceLifecycleId ||
        current.authorityRevision !== event.sourceAuthorityRevision
      ) {
        return current ?? null
      }
      const target = get().paneAgentLifecycleByPaneKey[event.toPaneKey]
      if (
        target ||
        event.executionHostId !== current.executionHostId ||
        current.ptyId !== event.ptyId
      ) {
        return null
      }
      const moved: PaneAgentLifecycle = {
        ...current,
        paneKey: event.toPaneKey,
        authorityRevision: event.authorityRevision
      }
      set((state) => {
        const next = { ...state.paneAgentLifecycleByPaneKey }
        delete next[event.fromPaneKey]
        next[event.toPaneKey] = moved
        return { paneAgentLifecycleByPaneKey: next }
      })
      return moved
    }

    const paneKey = event.paneKey
    const current = get().paneAgentLifecycleByPaneKey[paneKey]
    if (shouldIgnoreLateEvent(current, event)) {
      return current ?? null
    }
    if (event.type === 'pane-retired' || event.type === 'shell-confirmed') {
      if (!current) {
        return null
      }
      set((state) => {
        const next = { ...state.paneAgentLifecycleByPaneKey }
        delete next[paneKey]
        return { paneAgentLifecycleByPaneKey: next }
      })
      return null
    }
    if (event.type === 'foreground-inconclusive') {
      return current ?? null
    }
    if (event.type === 'transport-disconnected') {
      if (!current || current.connectionId !== event.connectionId) {
        return current ?? null
      }
      const disconnected = {
        ...current,
        phase: 'transport-disconnected' as const,
        authorityRevision: Math.max(current.authorityRevision, event.authorityRevision ?? 0)
      }
      if (!lifecycleEquals(current, disconnected)) {
        set((state) => ({
          paneAgentLifecycleByPaneKey: {
            ...state.paneAgentLifecycleByPaneKey,
            [paneKey]: disconnected
          }
        }))
      }
      return disconnected
    }

    const input = eventObservation(event)
    if (!input) {
      return current ?? null
    }
    const observedAt = input.observedAt ?? Date.now()
    const requiresReplacement =
      event.type === 'pty-replaced' &&
      current?.ptyId !== null &&
      current?.ptyId !== undefined &&
      normalizedValue(input.ptyId) !== current.ptyId
    const canKeep =
      current &&
      (event.type === 'transport-reattached'
        ? canReattach(current, input)
        : current.phase === 'transport-disconnected'
          ? false
          : hasCompatibleAuthority(current, input)) &&
      !requiresReplacement
    const lifecycle = canKeep
      ? mergeObservation(current, input, 'active')
      : lifecycleFromObservation(input, observedAt)

    if (current && lifecycleEquals(current, lifecycle)) {
      return current
    }
    set((state) => ({
      paneAgentLifecycleByPaneKey: {
        ...state.paneAgentLifecycleByPaneKey,
        [paneKey]: lifecycle
      }
    }))
    return lifecycle
  },

  observePaneAgentLifecycle: (input) =>
    get().dispatchPaneAgentLifecycleEvent({
      type:
        get().paneAgentLifecycleByPaneKey[input.paneKey]?.phase === 'transport-disconnected'
          ? 'transport-reattached'
          : 'agent-observed',
      ...input
    }),

  retirePaneAgentLifecycle: (paneKey) => {
    const lifecycle = get().paneAgentLifecycleByPaneKey[paneKey]
    if (!lifecycle) {
      return
    }
    get().dispatchPaneAgentLifecycleEvent({
      type: 'pane-retired',
      paneKey,
      authorityLifecycleId: lifecycle.id,
      authorityRevision: lifecycle.authorityRevision,
      observedAt: Date.now()
    })
  },

  transferPaneAgentLifecycle: (fromPaneKey, toPaneKey) => {
    const current = get().paneAgentLifecycleByPaneKey[fromPaneKey]
    if (!current?.ptyId) {
      return
    }
    get().dispatchPaneAgentLifecycleEvent({
      type: 'authority-transferred',
      fromPaneKey,
      toPaneKey,
      executionHostId: current.executionHostId,
      ptyId: current.ptyId,
      sourceLifecycleId: current.id,
      sourceAuthorityRevision: current.authorityRevision,
      authorityRevision: current.authorityRevision + 1,
      observedAt: Date.now()
    })
  },

  markPaneAgentLifecyclesTransportDisconnected: (connectionId) => {
    set((state) => {
      const lifecycles = markPaneAgentLifecyclesTransportDisconnected(
        state.paneAgentLifecycleByPaneKey,
        connectionId
      )
      return lifecycles === state.paneAgentLifecycleByPaneKey
        ? state
        : { paneAgentLifecycleByPaneKey: lifecycles }
    })
  },

  clearPaneAgentLifecyclesByTabPrefix: (tabId) => {
    const prefix = `${tabId}:`
    for (const paneKey of Object.keys(get().paneAgentLifecycleByPaneKey)) {
      if (paneKey.startsWith(prefix)) {
        get().retirePaneAgentLifecycle(paneKey)
      }
    }
  }
})
