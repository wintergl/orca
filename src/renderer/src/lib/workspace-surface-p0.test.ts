import { createStore, type StoreApi } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import { createEditorSlice } from '@/store/slices/editor'
import { createTabsSlice } from '@/store/slices/tabs'
import { hideTerminalVisibility } from '@/components/terminal-pane/terminal-visibility-resume'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { activateWorkspaceSurface } from './workspace-surface-activation'

/**
 * P0-R5/R6/R7/R8: workspace surface activation + light terminal hide under Workflows.
 * Git worktree and Folder workspace fixtures are mutually exclusive.
 */

type SurfaceKind = 'git-worktree' | 'folder-workspace'

function createSurfaceStore(kind: SurfaceKind, workspaceId: string): StoreApi<AppState> {
  const isFolder = kind === 'folder-workspace'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createStore<any>()((...args: any[]) => ({
    activeWorktreeId: workspaceId,
    activeView: 'workflows' as const,
    workflowTabOpen: true,
    previousViewBeforeWorkflows: 'terminal' as const,
    setActiveView: (_view: string) => undefined,
    tabsByWorktree: {},
    browserTabsByWorktree: {},
    activeBrowserTabId: null,
    activeBrowserTabIdByWorktree: {},
    activeTabIdByWorktree: {},
    unreadTerminalTabs: {},
    repos: isFolder ? [] : [{ id: 'repo-1', path: '/repo' }],
    worktreesByRepo: isFolder
      ? {}
      : {
          'repo-1': [{ id: workspaceId, repoId: 'repo-1', path: '/repo' }]
        },
    folderWorkspaces: isFolder
      ? [{ id: 'folder-ws-1', path: '/folder', name: 'Folder', createdAt: 0, updatedAt: 0 }]
      : [],
    projectGroups: [],
    recordFeatureInteraction: vi.fn(),
    ...createTabsSlice(...(args as Parameters<typeof createTabsSlice>)),
    ...createEditorSlice(...(args as Parameters<typeof createEditorSlice>))
  })) as unknown as StoreApi<AppState>
}

function bindSetActiveView(store: StoreApi<AppState>): void {
  store.setState({
    setActiveView: (view) => {
      store.setState({ activeView: view })
    }
  } as Partial<AppState>)
}

describe('P0 workspace surface activation (R5–R8)', () => {
  it.each([
    ['git-worktree', 'wt-git-1'] as const,
    ['folder-workspace', folderWorkspaceKey('folder-ws-1')] as const
  ])('R5: openFile from Workflows activates workspace surface for %s', (kind, workspaceId) => {
    const store = createSurfaceStore(kind, workspaceId)
    bindSetActiveView(store)
    if (kind === 'folder-workspace') {
      expect(store.getState().worktreesByRepo).toEqual({})
      expect(store.getState().folderWorkspaces.some((w) => w.id === 'folder-ws-1')).toBe(true)
      expect(workspaceId.startsWith('folder:')).toBe(true)
    } else {
      expect(store.getState().folderWorkspaces).toEqual([])
      expect(store.getState().worktreesByRepo['repo-1']?.some((w) => w.id === workspaceId)).toBe(
        true
      )
    }
    expect(store.getState().activeView).toBe('workflows')
    expect(store.getState().workflowTabOpen).toBe(true)

    store.getState().openFile(
      {
        filePath: `${workspaceId}/src/a.ts`,
        relativePath: 'src/a.ts',
        worktreeId: workspaceId,
        language: 'typescript',
        mode: 'edit'
      },
      { preview: true, focusEditor: true }
    )

    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(true)
    expect(store.getState().openFiles.some((f) => f.relativePath === 'src/a.ts')).toBe(true)
  })

  it('R6: consecutive previews replace the previous preview tab in the same group', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)

    store.getState().openFile(
      {
        filePath: '/repo/src/a.ts',
        relativePath: 'src/a.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        mode: 'edit'
      },
      { preview: true }
    )
    store.getState().openFile(
      {
        filePath: '/repo/src/b.ts',
        relativePath: 'src/b.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        mode: 'edit'
      },
      { preview: true }
    )

    const previews = store
      .getState()
      .openFiles.filter((f) => f.worktreeId === 'wt-1' && f.isPreview)
    expect(previews).toHaveLength(1)
    expect(previews[0]?.relativePath).toBe('src/b.ts')
    expect(store.getState().openFiles.some((f) => f.relativePath === 'src/a.ts')).toBe(false)
  })

  it('R5: createUnifiedTab from Workflows also activates workspace surface', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)
    store.getState().createUnifiedTab('wt-1', 'browser', {
      entityId: 'browser-1',
      label: 'Browser',
      activate: true
    })
    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(true)
  })

  it('R5: createUnifiedTabInSplit with activate:true leaves Workflows for workspace', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)
    const source = store.getState().createUnifiedTab('wt-1', 'terminal', {
      id: 'term-source',
      activate: true
    })
    store.setState({ activeView: 'workflows', workflowTabOpen: true })
    const sourceGroupId = store.getState().groupsByWorktree['wt-1']![0]!.id
    const split = store
      .getState()
      .createUnifiedTabInSplit(
        'wt-1',
        'browser',
        { sourceGroupId, splitDirection: 'right' },
        { entityId: 'browser-split', label: 'Split Browser', activate: true }
      )
    expect(split).not.toBeNull()
    expect(source?.id).toBe('term-source')
    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(true)
  })

  it('R5: createUnifiedTabInSplit with activate:false keeps Workflows surface', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)
    store.getState().createUnifiedTab('wt-1', 'terminal', {
      id: 'term-source',
      activate: true
    })
    store.setState({ activeView: 'workflows', workflowTabOpen: true })
    const sourceGroupId = store.getState().groupsByWorktree['wt-1']![0]!.id
    const split = store
      .getState()
      .createUnifiedTabInSplit(
        'wt-1',
        'browser',
        { sourceGroupId, splitDirection: 'right' },
        { entityId: 'browser-bg', label: 'Background Browser', activate: false }
      )
    expect(split).not.toBeNull()
    expect(store.getState().activeView).toBe('workflows')
    expect(store.getState().workflowTabOpen).toBe(true)
  })

  it('R5: activateTab from Workflows activates workspace surface', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)
    store.setState({ activeView: 'terminal' })
    const tab = store.getState().createUnifiedTab('wt-1', 'terminal', {
      id: 'term-1',
      activate: true
    })
    store.setState({ activeView: 'workflows', workflowTabOpen: true })
    store.getState().activateTab(tab!.id)
    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(true)
  })

  it('R5: activateTab from Workflows restores the editor surface identity', () => {
    const store = createSurfaceStore('git-worktree', 'wt-1')
    bindSetActiveView(store)
    store.setState({ activeView: 'terminal' })
    store.getState().createUnifiedTab('wt-1', 'terminal', {
      id: 'term-1',
      activate: true
    })
    store.setState({
      openFiles: [
        {
          id: '/repo/AGENTS.md',
          filePath: '/repo/AGENTS.md',
          relativePath: 'AGENTS.md',
          worktreeId: 'wt-1',
          language: 'markdown',
          isDirty: false,
          mode: 'edit'
        }
      ]
    })
    const editor = store.getState().createUnifiedTab('wt-1', 'editor', {
      entityId: '/repo/AGENTS.md',
      label: 'AGENTS.md',
      activate: false
    })
    store.setState({
      activeView: 'workflows',
      activeFileId: null,
      activeFileIdByWorktree: { 'wt-1': null },
      activeTabType: 'terminal',
      activeTabTypeByWorktree: { 'wt-1': 'terminal' }
    })

    store.getState().activateTab(editor.id, { preservePreview: true })

    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().groupsByWorktree['wt-1']?.[0]?.activeTabId).toBe(editor.id)
    expect(store.getState().activeFileId).toBe('/repo/AGENTS.md')
    expect(store.getState().activeFileIdByWorktree['wt-1']).toBe('/repo/AGENTS.md')
    expect(store.getState().activeTabType).toBe('editor')
    expect(store.getState().activeTabTypeByWorktree['wt-1']).toBe('editor')
  })

  it('R7: workflows overlay keeps light tab hide (no suspendRendering)', () => {
    const suspendRendering = vi.fn()
    const result = hideTerminalVisibility({
      manager: { suspendRendering } as unknown as PaneManager,
      wasVisible: true,
      wasWorktreeActive: true,
      isWorktreeActive: true,
      hasCompletedVisibleResume: true,
      captureViewportPositions: vi.fn(() => new Map())
    })
    expect(result).toEqual({ hiddenReason: 'tab', renderingSuspended: false })
    expect(suspendRendering).not.toHaveBeenCalled()
  })

  it('activateWorkspaceSurface is a no-op when already on terminal', () => {
    const setActiveView = vi.fn()
    activateWorkspaceSurface({ activeView: 'terminal', setActiveView })
    expect(setActiveView).not.toHaveBeenCalled()
  })
})
