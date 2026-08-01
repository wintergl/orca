// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowRunSummary
} from '../../../../shared/workflow-definition-types'
import { WorkflowRunHistory } from './WorkflowRunHistory'

const listWorkflowRuns = vi.fn()
const showWorkflowRun = vi.fn()

vi.mock('./workflow-runtime-client', () => ({
  listWorkflowRuns: (...args: unknown[]) => listWorkflowRuns(...args),
  showWorkflowRun: (...args: unknown[]) => showWorkflowRun(...args)
}))

vi.mock('./WorkflowRunDetail', () => ({
  WorkflowRunDetail: ({ run }: { run: WorkflowRunRecord }) => <div>Opened {run.templateName}</div>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkflowRunHistory', () => {
  it('filters by workspace and opens history without replacing the active Run', async () => {
    const summaries = [summary('run-one', 'SPEC Review'), summary('run-two', 'Code Review')]
    listWorkflowRuns.mockResolvedValue(summaries)
    showWorkflowRun.mockImplementation(async (_target, runId: string) =>
      detail(runId, runId === 'run-one' ? 'SPEC Review' : 'Code Review')
    )
    const onRunUpdated = vi.fn()

    render(
      <WorkflowRunHistory
        target={{ kind: 'local' }}
        context={{
          projectIdentity: 'project-a',
          projectName: 'Project A',
          workspaceId: 'folder-a',
          workspaceName: 'Folder A',
          workspaceKind: 'folder-workspace',
          executionHostId: 'local',
          target: { kind: 'local' }
        }}
        activeRun={null}
        selectedStepRunId={null}
        onRunUpdated={onRunUpdated}
        onBackToSetup={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText('Opened SPEC Review')).toBeTruthy())
    expect(listWorkflowRuns).toHaveBeenCalledWith(
      { kind: 'local' },
      expect.objectContaining({
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' }
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /Code Review/ }))
    await waitFor(() => expect(screen.getByText('Opened Code Review')).toBeTruthy())
    expect(onRunUpdated).not.toHaveBeenCalled()
  })

  it('queries history by template and creation date range', async () => {
    const user = userEvent.setup()
    const summaries = [summary('run-one', 'SPEC Review'), summary('run-two', 'Code Review')]
    listWorkflowRuns.mockImplementation(async (_target, filter: { templateId?: string }) =>
      filter.templateId
        ? summaries.filter((run) => run.templateId === filter.templateId)
        : summaries
    )
    showWorkflowRun.mockImplementation(async (_target, runId: string) =>
      detail(runId, runId === 'run-one' ? 'SPEC Review' : 'Code Review')
    )

    render(
      <WorkflowRunHistory
        target={{ kind: 'local' }}
        context={{
          projectIdentity: 'project-a',
          projectName: 'Project A',
          workspaceId: 'folder-a',
          workspaceName: 'Folder A',
          workspaceKind: 'folder-workspace',
          executionHostId: 'local',
          target: { kind: 'local' }
        }}
        activeRun={null}
        selectedStepRunId={null}
        onRunUpdated={vi.fn()}
        onBackToSetup={vi.fn()}
      />
    )

    await user.click(await screen.findByRole('combobox', { name: 'Template' }))
    await user.click(screen.getByRole('option', { name: 'Code Review' }))
    await waitFor(() =>
      expect(listWorkflowRuns).toHaveBeenCalledWith(
        { kind: 'local' },
        expect.objectContaining({ templateId: 'template-run-two' })
      )
    )

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-31' } })
    await waitFor(() =>
      expect(listWorkflowRuns).toHaveBeenCalledWith(
        { kind: 'local' },
        expect.objectContaining({
          templateId: 'template-run-two',
          createdFrom: new Date('2026-07-01T00:00:00.000').toISOString(),
          createdTo: new Date('2026-07-31T23:59:59.999').toISOString()
        })
      )
    )
  })
})

function summary(id: string, templateName: string): WorkflowRunSummary {
  return {
    id,
    status: 'completed',
    templateId: `template-${id}`,
    templateVersion: 1,
    templateName,
    projectIdentity: 'project-a',
    workspace: { kind: 'folder-workspace', id: 'folder-a' },
    executionHostId: 'local',
    objective: `${templateName} objective`,
    currentNodeId: null,
    waitingReason: null,
    startedAt: '2026-07-29T00:00:00.000Z',
    completedAt: '2026-07-29T00:01:00.000Z',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:01:00.000Z'
  }
}

function detail(id: string, templateName: string): WorkflowRunRecord {
  return {
    id,
    status: 'completed',
    templateName,
    steps: [],
    artifacts: [],
    reviewAggregates: [],
    decisions: []
  } as unknown as WorkflowRunRecord
}
