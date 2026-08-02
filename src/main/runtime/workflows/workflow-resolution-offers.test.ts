import { describe, expect, it } from 'vitest'
import type {
  WorkflowResolutionAction,
  WorkflowRunRecord,
  WorkflowWaitingReason
} from '../../../shared/workflow-definition-types'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { buildWorkflowResolutionOffers } from './workflow-resolution-offers'

const EXPECTED: Record<WorkflowWaitingReason, WorkflowResolutionAction[]> = {
  'review-request-human': ['view-evidence', 'approve', 'revise', 'end-workflow'],
  'review-revision-required': ['view-evidence', 'approve', 'revise', 'end-workflow'],
  'review-conflict': ['view-evidence', 'approve', 'revise', 'retry-step', 'end-workflow'],
  'review-limit-reached': ['view-evidence', 'revise', 'continue-round', 'approve', 'end-workflow'],
  'agent-unavailable': ['view-evidence', 'reassign-agent', 'retry-step', 'end-workflow'],
  'lifecycle-mismatch': ['view-evidence', 'reassign-agent', 'end-workflow'],
  'permission-required': ['view-evidence', 'resolve-permission', 'retry-step', 'end-workflow'],
  'transport-disconnected': [
    'view-evidence',
    'wait-for-reconnect',
    'reassign-agent',
    'end-workflow'
  ],
  'reviewer-retry-exhausted': ['view-evidence', 'retry-step', 'reassign-agent', 'end-workflow'],
  'decision-invalid': ['view-evidence', 'retry-step', 'approve', 'revise', 'end-workflow'],
  'delivery-uncertain': [
    'view-evidence',
    'wait-for-reconnect',
    'retry-with-duplicate-risk',
    'end-workflow'
  ],
  'artifact-unavailable': ['view-evidence', 'regenerate-artifact', 'retry-step', 'end-workflow'],
  'artifact-drifted': ['view-evidence', 'regenerate-artifact', 'end-workflow'],
  'completion-incomplete': ['view-evidence', 'retry-step', 'reassign-agent', 'end-workflow']
}

describe('Workflow Resolution Offers', () => {
  it('returns exactly the frozen action matrix for every waiting reason', () => {
    for (const [reason, actions] of Object.entries(EXPECTED) as [
      WorkflowWaitingReason,
      WorkflowResolutionAction[]
    ][]) {
      const offers = buildWorkflowResolutionOffers(runFor(reason))
      expect(
        offers.map((offer) => offer.action),
        `actions for ${reason}`
      ).toEqual(actions)
      expect(offers.every((offer) => offer.waitingReason === reason)).toBe(true)
    }
  })

  it('binds approve and continue-round to the frozen origin Decision transitions', () => {
    const offers = buildWorkflowResolutionOffers(runFor('review-limit-reached'))
    expect(offers.find((offer) => offer.action === 'approve')).toMatchObject({
      originDecisionStepId: 'decision-step',
      reviewNodeId: 'code-review',
      resolutionTransitionId: 'code-decision-approved',
      expectedRunVersion: 7
    })
    expect(offers.find((offer) => offer.action === 'continue-round')).toMatchObject({
      resolutionTransitionId: 'code-decision-revise',
      requiresConfirmation: true
    })
  })

  it('never offers approval for unsafe evidence or identity states', () => {
    for (const reason of [
      'delivery-uncertain',
      'lifecycle-mismatch',
      'artifact-unavailable',
      'artifact-drifted',
      'completion-incomplete'
    ] as const) {
      expect(
        buildWorkflowResolutionOffers(runFor(reason)).some((offer) => offer.action === 'approve')
      ).toBe(false)
    }
  })

  it('uses the configured Human Gate actions for review intervention', () => {
    const run = runFor('review-request-human')
    const gate = run.templateSnapshot.nodes.find((node) => node.type === 'human-gate')!
    if (gate.type === 'human-gate') {
      gate.allowedActions = ['view-evidence', 'revise']
    }

    expect(buildWorkflowResolutionOffers(run).map((offer) => offer.action)).toEqual([
      'view-evidence',
      'revise'
    ])
  })
})

function runFor(reason: WorkflowWaitingReason): WorkflowRunRecord {
  const template = BUILTIN_WORKFLOW_TEMPLATES.find(
    (candidate) => candidate.id === 'builtin.code-review.v1'
  )!
  return {
    id: 'run-1',
    status: reason === 'review-limit-reached' ? 'review-limit-reached' : 'waiting-human',
    version: 7,
    templateId: template.id,
    templateVersion: template.version,
    templateName: template.name,
    templateSnapshot: structuredClone(template.definition),
    ownerIdentity: 'user-a',
    projectIdentity: 'project-a',
    workspace: { kind: 'folder-workspace', id: 'folder-a' },
    executionHostId: 'local',
    objective: 'Review safely.',
    assignments: [],
    currentNodeId: 'code-decide',
    orchestrationRunId: null,
    waitingReason: reason,
    resolutionContext: {
      originDecisionStepId: 'decision-step',
      originDecisionNodeId: 'code-decide',
      reviewNodeId: 'code-review',
      artifactRevisionId: 'artifact-1',
      approveTransitionId: 'code-decision-approved',
      reviseTransitionId: 'code-decision-revise'
    },
    resolutionOffers: [],
    reviewRoundsByNodeId: { 'code-review': 3 },
    parentRunId: null,
    rootRunId: 'run-1',
    lineageCycleBase: 0,
    rerunReason: null,
    noAdditionalRequirements: false,
    policyOverrides: null,
    promptOverrides: null,
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
    updatedAt: new Date().toISOString()
  }
}
