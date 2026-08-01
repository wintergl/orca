import { describe, expect, it, vi } from 'vitest'
import { activateWorkspaceSurface } from './workspace-surface-activation'

describe('activateWorkspaceSurface', () => {
  it('switches from workflows to terminal while leaving other views alone', () => {
    const setActiveView = vi.fn()
    activateWorkspaceSurface({ activeView: 'workflows', setActiveView })
    expect(setActiveView).toHaveBeenCalledWith('terminal')

    setActiveView.mockClear()
    activateWorkspaceSurface({ activeView: 'terminal', setActiveView })
    expect(setActiveView).not.toHaveBeenCalled()

    activateWorkspaceSurface({ activeView: 'settings', setActiveView })
    expect(setActiveView).not.toHaveBeenCalled()
  })
})
