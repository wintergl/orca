import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import { claimWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import type { WorkflowMutation } from './workflow-mutation-ledger'
import type { WorkflowStore } from './workflow-store'

export function readyRun(
  store: WorkflowStore,
  runtime: OrcaRuntimeService,
  reviewerCount = 1,
  templateId = 'builtin.code-review.v1',
  decisionAgent = false
): string {
  const created = store.createRun(
    {
      templateId,
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation('create', { template: 'code' })
  )
  for (const [nodeId, slotId, assignment] of [
    ['code-produce', 'implementer', assigned('pane-producer', 'producer', 'session-producer')],
    ['code-review', 'code-reviewers', assigned('pane-reviewer', 'reviewer', 'session-reviewer')]
  ] as const) {
    store.assignAgent(
      { runId: created.id, nodeId, slotId, assignment },
      mutation(`assign-${nodeId}`, { nodeId })
    )
    claimWorkflowAgentLifecycle(
      runtime,
      assignment,
      assignment.paneKey === 'pane-producer' ? 'terminal-producer' : 'terminal-reviewer'
    )
  }
  if (reviewerCount > 1) {
    const secondReviewer = assigned('pane-reviewer-2', 'reviewer-2', 'session-reviewer-2')
    store.assignAgent(
      {
        runId: created.id,
        nodeId: 'code-review',
        slotId: 'code-reviewers',
        assignment: secondReviewer
      },
      mutation('assign-code-review-2', { nodeId: 'code-review' })
    )
    claimWorkflowAgentLifecycle(runtime, secondReviewer, 'terminal-reviewer-2')
  }
  if (decisionAgent) {
    const decider = assigned('pane-decider', 'decider', 'session-decider')
    store.assignAgent(
      {
        runId: created.id,
        nodeId: 'code-decide',
        slotId: 'code-decider',
        assignment: decider
      },
      mutation('assign-code-decider', { nodeId: 'code-decide' })
    )
    claimWorkflowAgentLifecycle(runtime, decider, 'terminal-decider')
  }
  store.updateRunObjective(
    { runId: created.id, objective: 'Change and review src/result.ts.' },
    mutation('objective', { runId: created.id })
  )
  return store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('prepare', { runId: created.id })
  ).run.id
}

export function readyCombinedRun(store: WorkflowStore, runtime: OrcaRuntimeService): string {
  const created = store.createRun(
    {
      templateId: 'builtin.spec-to-code-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation('create-combined', { template: 'combined' })
  )
  for (const [nodeId, slotId, assignment, handle] of [
    [
      'spec-produce',
      'spec-author',
      assigned('pane-spec-producer', 'spec-producer', 'session-spec-producer'),
      'terminal-spec-producer'
    ],
    [
      'spec-review',
      'spec-reviewers',
      assigned('pane-spec-reviewer', 'spec-reviewer', 'session-spec-reviewer'),
      'terminal-spec-reviewer'
    ],
    [
      'code-produce',
      'implementer',
      assigned('pane-producer', 'producer', 'session-producer'),
      'terminal-producer'
    ],
    [
      'code-review',
      'code-reviewers',
      assigned('pane-reviewer', 'reviewer', 'session-reviewer'),
      'terminal-reviewer'
    ]
  ] as const) {
    store.assignAgent(
      { runId: created.id, nodeId, slotId, assignment },
      mutation(`assign-combined-${nodeId}`, { nodeId })
    )
    claimWorkflowAgentLifecycle(runtime, assignment, handle)
  }
  store.updateRunObjective(
    { runId: created.id, objective: 'Write a SPEC, implement it, and review both artifacts.' },
    mutation('combined-objective', { runId: created.id })
  )
  return store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('combined-prepare', { runId: created.id })
  ).run.id
}

export function assigned(
  paneKey: string,
  lifecycle: string,
  providerSessionId: string
): Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> {
  return {
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey,
    agentLifecycleId: lifecycle,
    providerSessionId,
    runtimeAgent: 'codex'
  }
}

export function mutation(requestId: string, payload: unknown): WorkflowMutation {
  return {
    callerIdentity: 'user-a',
    requestId,
    method:
      requestId === 'start-once' || requestId === 'start-complete'
        ? 'workflow.runStart'
        : `test.${requestId}`,
    payload
  }
}

export function match(value: string, pattern: RegExp): string {
  const found = pattern.exec(value)?.[1]?.trim()
  if (!found) {
    throw new Error(`Pattern ${pattern} did not match the Workflow prompt.`)
  }
  return found
}
