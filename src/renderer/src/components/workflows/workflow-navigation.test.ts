import { describe, expect, it } from 'vitest'
import { isTopLevelView } from '../../../../shared/top-level-view'
import { buildActiveViewUnloadPatch } from '@/lib/active-view-persist'
import { createTestStore } from '@/store/slices/store-test-helpers'

describe('Workflows top-level navigation', () => {
  it('accepts Workflows as a transient top-level view', () => {
    expect(isTopLevelView('workflows')).toBe(true)
    expect(buildActiveViewUnloadPatch({ activeView: 'workflows', persistedUIReady: true })).toEqual(
      { activeView: 'terminal' }
    )
  })

  it('keeps the temporary tab open when another workspace tab becomes active', () => {
    const store = createTestStore()

    store.getState().openWorkflowsPage()
    store.getState().setActiveView('terminal')

    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(true)
  })

  it('closes an inactive Workflow tab without navigating away from the current view', () => {
    const store = createTestStore()
    store.setState({ activeView: 'tasks' })
    store.getState().openWorkflowsPage()
    store.getState().setActiveView('terminal')

    store.getState().closeWorkflowsPage()

    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().workflowTabOpen).toBe(false)
  })

  it('restores the previous view when the active Workflow tab closes', () => {
    const store = createTestStore()
    store.setState({ activeView: 'tasks' })
    store.getState().openWorkflowsPage()

    store.getState().closeWorkflowsPage()

    expect(store.getState().activeView).toBe('tasks')
    expect(store.getState().workflowTabOpen).toBe(false)
  })
})
