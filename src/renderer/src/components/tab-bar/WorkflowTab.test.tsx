// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowTab } from './WorkflowTab'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('./tab-strip-pointer-activation', () => ({
  useTabStripPointerActivation: ({ onActivate }: { onActivate: () => void }) => ({
    onPointerDown: onActivate
  })
}))

vi.mock('./EditorFileTabCloseButton', () => ({
  EditorFileTabCloseButton: ({ onClose }: { onClose: () => void }) => (
    <button type="button" aria-label="Close tab" onClick={onClose} />
  )
}))

afterEach(cleanup)

describe('WorkflowTab', () => {
  it('exposes an explicit close action', () => {
    const onClose = vi.fn()
    render(<WorkflowTab id="workflow" isActive onActivate={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes with the standard middle-click gesture', () => {
    const onClose = vi.fn()
    render(<WorkflowTab id="workflow" isActive onActivate={vi.fn()} onClose={onClose} />)

    fireEvent(screen.getByRole('tab'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
