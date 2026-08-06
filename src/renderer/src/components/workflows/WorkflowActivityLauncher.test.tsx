// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowTemplateRecord } from '../../../../shared/workflow-definition-types'
import { WorkflowActivityLauncher } from './WorkflowActivityLauncher'

afterEach(cleanup)

describe('WorkflowActivityLauncher', () => {
  it('explains and unlocks a selected V2 template instead of failing on configure', () => {
    const onEnableWorkflowV2 = vi.fn()
    render(
      <WorkflowActivityLauncher
        templates={[v2Template()]}
        selectedTemplate={v2Template()}
        workspaceLabel="Project · main"
        workflowV2Enabled={false}
        enablingWorkflowV2={false}
        disabled={false}
        onSelect={vi.fn()}
        onConfigure={vi.fn()}
        onEnableWorkflowV2={onEnableWorkflowV2}
        onOpenTemplates={vi.fn()}
      />
    )

    expect(screen.getByText(/view-only until Workflow V2 is enabled/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Configure and run' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Enable Workflow V2' }))
    expect(onEnableWorkflowV2).toHaveBeenCalledTimes(1)
  })
})

function v2Template(): WorkflowTemplateRecord {
  return {
    id: 'builtin.v2.spec-review',
    name: 'SPEC 编写 + 评审',
    scope: 'built-in',
    currentVersion: 1,
    definition: { schemaVersion: 2 }
  } as WorkflowTemplateRecord
}
