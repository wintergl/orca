// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from '../../../../shared/workflow-v2-fixtures'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import { WorkflowTemplateV2Editor } from './WorkflowTemplateV2Editor'

afterEach(cleanup)

function definition(): WorkflowDefinitionV2 {
  return structuredClone(BUILTIN_WORKFLOW_V2_TEMPLATES[0]!.definition)
}

describe('WorkflowTemplateV2Editor', () => {
  it('shows configured role labels instead of internal role IDs', async () => {
    const source = definition()
    const user = userEvent.setup()
    render(<WorkflowTemplateV2Editor definition={source} readOnly={false} onChange={vi.fn()} />)

    const roleSelect = screen
      .getAllByRole('combobox')
      .find((select) => select.textContent === source.roleSlots[0]!.label)
    expect(roleSelect).toBeTruthy()

    await user.click(roleSelect!)
    for (const role of source.roleSlots) {
      expect(screen.getByRole('option', { name: role.label })).toBeTruthy()
      expect(screen.queryByRole('option', { name: role.id })).toBeNull()
    }
  })

  it('moves steps earlier and later from the step list', () => {
    const source = definition()
    const onChange = vi.fn()
    render(<WorkflowTemplateV2Editor definition={source} readOnly={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: `Move ${source.steps[1]!.name} earlier` }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].steps.map((step) => step.id)).toEqual([
      source.steps[1]!.id,
      source.steps[0]!.id,
      ...source.steps.slice(2).map((step) => step.id)
    ])
  })

  it('allows an extra End to be removed while keeping the last End protected', () => {
    const source = definition()
    source.steps = source.steps.filter((step) => step.kind !== 'end' || step.id === 'complete')
    const onChange = vi.fn()
    const first = render(
      <WorkflowTemplateV2Editor definition={source} readOnly={false} onChange={onChange} />
    )
    expect(
      screen
        .getByRole('button', {
          name: `Remove ${source.steps.find((step) => step.id === 'complete')!.name}`
        })
        .hasAttribute('disabled')
    ).toBe(true)
    first.unmount()

    source.steps.push({ id: 'cancelled-end', name: 'Cancelled', kind: 'end', outcome: 'cancelled' })
    render(<WorkflowTemplateV2Editor definition={source} readOnly={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cancelled' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].steps.some((step) => step.id === 'cancelled-end')).toBe(false)
  })
})
