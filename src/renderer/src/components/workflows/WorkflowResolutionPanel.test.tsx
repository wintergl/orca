// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../../shared/workflow-fixtures'
import { setWorkflowAssignableAgents } from './workflow-renderer-state'
import { WorkflowResolutionPanel } from './WorkflowResolutionPanel'

const resolveWorkflowRun = vi.fn()
const reassignWorkflowStep = vi.fn()

vi.mock('./workflow-runtime-client', () => ({
  resolveWorkflowRun: (...args: unknown[]) => resolveWorkflowRun(...args),
  reassignWorkflowStep: (...args: unknown[]) => reassignWorkflowStep(...args)
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setWorkflowAssignableAgents([])
})

describe('WorkflowResolutionPanel', () => {
  it('renders only Engine Offers and confirms continue-round before submitting', async () => {
    const run = limitedRun()
    const onRunUpdated = vi.fn()
    resolveWorkflowRun.mockResolvedValue({ ...run, status: 'running', version: 8 })
    render(
      <WorkflowResolutionPanel
        run={run}
        target={{ kind: 'local' }}
        onRunUpdated={onRunUpdated}
        onOpenEvidence={vi.fn()}
      />
    )

    expect(screen.getByText('Review limit reached')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue one round' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Return for revision' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue one round' }))
    const confirmationButtons = screen.getAllByRole('button', { name: 'Continue one round' })
    fireEvent.click(confirmationButtons.at(-1)!)

    await waitFor(() => expect(resolveWorkflowRun).toHaveBeenCalledTimes(1))
    expect(resolveWorkflowRun.mock.calls[0]?.[2]).toMatchObject({
      action: 'continue-round',
      resolutionTransitionId: 'code-decision-revise'
    })
    expect(resolveWorkflowRun.mock.calls[0]?.[3]).toEqual({
      reason: undefined,
      confirmation: true
    })
    expect(onRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }))
  })

  it('submits human instructions with a fresh consumable Review budget', async () => {
    const run = limitedRun()
    resolveWorkflowRun.mockResolvedValue({ ...run, status: 'running', version: 8 })
    render(
      <WorkflowResolutionPanel
        run={run}
        target={{ kind: 'local' }}
        onRunUpdated={vi.fn()}
        onOpenEvidence={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Return for revision' }))
    fireEvent.change(screen.getByLabelText('Resolution reason'), {
      target: { value: 'Preserve compatibility and add the missing test.' }
    })
    fireEvent.change(screen.getByLabelText('Review rounds after intervention'), {
      target: { value: '2' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Return for revision' }).at(-1)!)

    await waitFor(() => expect(resolveWorkflowRun).toHaveBeenCalledTimes(1))
    expect(resolveWorkflowRun.mock.calls[0]?.[3]).toEqual({
      reason: 'Preserve compatibility and add the missing test.',
      reviewRoundBudget: 2,
      confirmation: true
    })
  })

  it('requires an eligible replacement Agent and a reason before reassignment', async () => {
    const run = reassignRun()
    const onRunUpdated = vi.fn()
    const replacement = {
      id: 'agent-new',
      label: 'Replacement Agent',
      worktreeId: 'folder-a',
      executionHostId: 'local',
      paneKey: 'pane-new',
      agentLifecycleId: 'lifecycle-new',
      providerSessionId: 'session-new',
      runtimeAgent: 'codex',
      currentTask: null
    }
    setWorkflowAssignableAgents([replacement])
    reassignWorkflowStep.mockResolvedValue({ ...run, status: 'running', version: 8 })
    render(
      <WorkflowResolutionPanel
        run={run}
        target={{ kind: 'local' }}
        onRunUpdated={onRunUpdated}
        onOpenEvidence={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reassign Agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose replacement Agent' }))
    fireEvent.click(screen.getByRole('button', { name: /Replacement Agent/ }))
    fireEvent.change(screen.getByLabelText('Resolution reason'), {
      target: { value: 'The original lifecycle is unavailable.' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Reassign Agent' }).at(-1)!)

    await waitFor(() => expect(reassignWorkflowStep).toHaveBeenCalledTimes(1))
    expect(reassignWorkflowStep.mock.calls[0]?.slice(1)).toEqual([
      run,
      'decision-step',
      expect.objectContaining({ agentLifecycleId: 'lifecycle-new', paneKey: 'pane-new' }),
      'The original lifecycle is unavailable.'
    ])
    expect(onRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }))
  })
})

function reassignRun(): WorkflowRunRecord {
  const run = limitedRun()
  return {
    ...run,
    status: 'waiting-human',
    waitingReason: 'agent-unavailable',
    steps: [
      {
        id: 'decision-step',
        assignment: {
          nodeId: 'code-produce',
          slotId: 'implementer',
          worktreeId: 'folder-a',
          executionHostId: 'local',
          paneKey: 'pane-old',
          agentLifecycleId: 'lifecycle-old',
          providerSessionId: 'session-old',
          runtimeAgent: 'codex'
        }
      } as WorkflowRunRecord['steps'][number]
    ],
    resolutionOffers: [
      {
        ...run.resolutionOffers[0]!,
        id: 'offer-reassign',
        waitingReason: 'agent-unavailable',
        action: 'reassign-agent',
        resolutionTransitionId: 'run-resolution:reassign-agent',
        requiresConfirmation: false
      }
    ]
  }
}

function limitedRun(): WorkflowRunRecord {
  const template = BUILTIN_WORKFLOW_TEMPLATES.find(
    (candidate) => candidate.id === 'builtin.code-review.v1'
  )!
  const context = {
    originDecisionStepId: 'decision-step',
    originDecisionNodeId: 'code-decide',
    reviewNodeId: 'code-review',
    artifactRevisionId: 'artifact-1',
    approveTransitionId: 'code-decision-approved',
    reviseTransitionId: 'code-decision-revise'
  }
  return {
    id: 'run-1',
    status: 'review-limit-reached',
    version: 7,
    templateId: template.id,
    templateVersion: 1,
    templateName: template.name,
    templateSnapshot: template.definition,
    ownerIdentity: 'user-a',
    projectIdentity: 'project-a',
    workspace: { kind: 'folder-workspace', id: 'folder-a' },
    executionHostId: 'local',
    objective: 'Review safely.',
    assignments: [],
    currentNodeId: 'code-decide',
    orchestrationRunId: null,
    waitingReason: 'review-limit-reached',
    resolutionContext: context,
    resolutionOffers: [
      offer('view-evidence', 'run-resolution:view-evidence'),
      offer('revise', 'code-decision-revise'),
      offer('continue-round', 'code-decision-revise'),
      offer('approve', 'code-decision-approved'),
      offer('end-workflow', 'run-resolution:end-workflow')
    ],
    reviewRoundsByNodeId: { 'code-review': 3 },
    reviewRoundExtensionsByNodeId: {},
    failureCode: null,
    failureMessage: null,
    recovery: null,
    startedAt: '2026-07-29T00:00:00.000Z',
    completedAt: null,
    steps: [],
    artifacts: [],
    reviewAggregates: [],
    decisions: [],
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z'
  }

  function offer(
    action: WorkflowRunRecord['resolutionOffers'][number]['action'],
    resolutionTransitionId: string
  ): WorkflowRunRecord['resolutionOffers'][number] {
    return {
      id: `offer-${action}`,
      runId: 'run-1',
      waitingReason: 'review-limit-reached',
      action,
      originDecisionStepId: context.originDecisionStepId,
      reviewNodeId: context.reviewNodeId,
      resolutionTransitionId,
      expectedRunVersion: 7,
      preconditions: [],
      requiresReason: false,
      requiresConfirmation: action !== 'view-evidence',
      requiredPermission: action === 'approve' ? 'workflow-approve' : 'workflow-operate',
      expiresAt: '2026-07-30T00:00:00.000Z'
    }
  }
}
