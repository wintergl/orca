// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../../shared/workflow-fixtures'
import { WorkflowTemplateDefinitionSurface } from './WorkflowTemplateDefinitionSurface'

vi.mock('./WorkflowTemplateVisualEditor', () => ({
  WorkflowTemplateVisualEditor: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="v1-editor" data-read-only={String(readOnly)} />
  )
}))

vi.mock('./WorkflowTemplateV2Editor', () => ({
  WorkflowTemplateV2Editor: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="v2-editor" data-read-only={String(readOnly)} />
  )
}))

afterEach(cleanup)

describe('WorkflowTemplateDefinitionSurface', () => {
  it('explains the active-run lock and links to prompt history', () => {
    const onOpenHistory = vi.fn()
    render(
      <WorkflowTemplateDefinitionSurface
        draft={{
          kind: 'existing',
          templateId: 'builtin.spec-review.v1',
          expectedVersion: 5,
          definition: BUILTIN_WORKFLOW_TEMPLATES[0]!.definition
        }}
        readOnly
        workflowV2Blocked={false}
        activeRunCount={2}
        enablingWorkflowV2={false}
        onEnableWorkflowV2={vi.fn()}
        onOpenHistory={onOpenHistory}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('status').textContent).toContain('2')
    expect(screen.getByTestId('v1-editor').dataset.readOnly).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open prompt history' }))
    expect(onOpenHistory).toHaveBeenCalledOnce()
  })
})
