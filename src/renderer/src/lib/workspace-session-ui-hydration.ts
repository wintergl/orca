import type { ExecutionHostId } from '../../../shared/execution-host'
import type { WorkspaceSessionState } from '../../../shared/types'
import type { AppState } from '@/store'
import type { WorkspaceSessionHydrationOptions } from './workspace-session-hydration-keys'

type WorkspaceSessionUiHydrationActions = Pick<
  AppState,
  | 'hydrateWorkspaceSession'
  | 'hydrateTabsSession'
  | 'hydrateEditorSession'
  | 'hydrateBrowserSession'
  | 'setWorkspaceSessionUiReady'
>

export function hydrateWorkspaceSessionUiState(args: {
  actions: WorkspaceSessionUiHydrationActions
  session: WorkspaceSessionState
  options: WorkspaceSessionHydrationOptions
  runtimeHostIdByWorkspaceSessionKey: Record<string, ExecutionHostId>
}): void {
  const { actions, session, options, runtimeHostIdByWorkspaceSessionKey } = args
  actions.hydrateWorkspaceSession(session, {
    ...options,
    runtimeHostIdByWorkspaceSessionKey
  })
  actions.hydrateTabsSession(session, options)
  actions.hydrateEditorSession(session, options)
  actions.hydrateBrowserSession(session, options)
  actions.setWorkspaceSessionUiReady(true)
}
