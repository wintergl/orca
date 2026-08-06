// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { RightSidebarPanelContent } from './right-sidebar-panel-content'

afterEach(() => {
  cleanup()
  useAppStore.setState({ workspaceSessionUiReady: false })
})

describe('RightSidebarPanelContent startup gate', () => {
  it('does not mount interactive panels before persisted workspace UI is applied', () => {
    useAppStore.setState({ workspaceSessionUiReady: false })

    render(<RightSidebarPanelContent effectiveTab="explorer" rightSidebarOpen />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading files...')
    expect(document.querySelector('[data-orca-explorer-shell]')).not.toBeInTheDocument()
  })
})
