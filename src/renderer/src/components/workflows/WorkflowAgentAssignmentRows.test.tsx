// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { getBuiltinWorkflowTemplate } from '../../../../shared/workflow-fixtures'
import { WorkflowAgentAssignmentRows } from './WorkflowAgentAssignmentRows'

afterEach(cleanup)

describe('WorkflowAgentAssignmentRows', () => {
  it('renders only assignable nodes while preserving the full workflow sequence', () => {
    render(
      <WorkflowAgentAssignmentRows
        run={runRecord()}
        onChoose={vi.fn()}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />
    )

    expect(screen.getAllByText('SPEC 编写')).toHaveLength(2)
    expect(screen.getAllByText('SPEC 评审')).toHaveLength(2)
    expect(screen.getAllByText('SPEC 判定')).toHaveLength(2)
    expect(screen.getByText('SPEC 人工决定')).toBeTruthy()
    expect(screen.getByText('完成')).toBeTruthy()
    expect(screen.queryByText('This node does not require an Agent assignment.')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Assign Agent to/ })).toHaveLength(3)
  })

  it('opens the picker for the selected role row', () => {
    const onChoose = vi.fn()
    render(
      <WorkflowAgentAssignmentRows
        run={runRecord()}
        onChoose={onChoose}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByText('Drop an idle Agent here or click to choose')[1])
    expect(onChoose).toHaveBeenCalledWith({
      nodeId: 'spec-review',
      slotId: 'spec-reviewers'
    })
  })
})

function runRecord(): WorkflowRunRecord {
  const template = getBuiltinWorkflowTemplate('builtin.spec-review.v1')
  if (!template) {
    throw new Error('SPEC review fixture is missing')
  }
  return {
    id: 'run-one',
    assignments: [],
    templateSnapshot: template.definition
  } as unknown as WorkflowRunRecord
}
