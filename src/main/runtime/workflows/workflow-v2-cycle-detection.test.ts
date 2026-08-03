import { afterEach, describe, expect, it } from 'vitest'
import {
  completeWorkflowV2AgentStep,
  type WorkflowV2RuntimeSurface
} from './workflow-v2-run-controller'
import { WorkflowStore } from './workflow-store'

const stores: WorkflowStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
})

describe('Workflow V2 generic cycle detection', () => {
  it('increments the business cycle for an arbitrary agent route back edge', () => {
    const store = new WorkflowStore(':memory:')
    stores.push(store)
    const template = store.createTemplate(
      {
        name: 'Generic agent cycle',
        scope: 'personal',
        definition: {
          schemaVersion: 2,
          decisionProtocolVersion: 'v2-binary-zh',
          entryStepId: 'draft',
          roleSlots: [
            {
              id: 'worker',
              label: 'Worker',
              required: true,
              minAgents: 1,
              maxAgents: 1,
              execution: 'single',
              allowedAgentStates: ['idle']
            }
          ],
          steps: [
            agentStep('draft', 'inspect', { targetStepId: 'inspect' }),
            agentStep('inspect', 'draft', {
              targetStepId: 'draft',
              maxTraversals: 1,
              onExhaustedStepId: 'end'
            }),
            { id: 'end', name: 'End', kind: 'end', outcome: 'succeeded' }
          ]
        }
      },
      mutation('template')
    )
    const created = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'local'
      },
      mutation('create')
    )
    for (const nodeId of ['draft', 'inspect']) {
      store.assignAgent(
        {
          runId: created.id,
          nodeId,
          slotId: 'worker',
          assignment: {
            worktreeId: 'folder-a',
            executionHostId: 'local',
            paneKey: `pane-${nodeId}`,
            agentLifecycleId: nodeId,
            providerSessionId: `session-${nodeId}`,
            runtimeAgent: 'codex'
          }
        },
        mutation(`assign-${nodeId}`)
      )
    }
    store.updateRunObjective({ runId: created.id, objective: 'cycle' }, mutation('objective'))
    const prepared = store.prepareRun(
      {
        runId: created.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: []
      },
      mutation('prepare')
    )
    expect(prepared.ready).toBe(true)
    let run = store.beginRun({ runId: created.id, baseline: {} }, mutation('start'))
    const draft = run.steps.find((step) => step.nodeId === 'draft')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: draft,
      finalText: 'v1'
    })
    run = store.showRun(run.id, 'user-a')
    const inspect = run.steps.find((step) => step.nodeId === 'inspect')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: inspect,
      finalText: 'revise'
    })
    run = store.showRun(run.id, 'user-a')
    expect(
      run.steps.find((step) => step.nodeId === 'draft' && step.status === 'queued')?.round
    ).toBe(2)
  })
})

function agentStep(
  id: string,
  name: string,
  next: { targetStepId: string; maxTraversals?: number; onExhaustedStepId?: string }
) {
  return {
    id,
    name,
    kind: 'agent' as const,
    roleSlotIds: ['worker'],
    execution: 'single' as const,
    prompt: {
      variants: [
        { when: 'first-visit' as const, template: 'first {{goal}} {{criteria}}' },
        { when: 'repeat-visit' as const, template: 'repeat {{goal}} {{criteria}}' }
      ],
      completionCriteria: 'done',
      repeatVisitHistoryMode: 'not-required' as const
    },
    retryPolicy: { maxAttempts: 1, backoffMs: 0, onExhausted: 'fail-run' as const },
    next
  }
}

function surface(store: WorkflowStore): WorkflowV2RuntimeSurface {
  return {
    db: store.persistenceDb,
    finishEngineStep: () => undefined,
    insertEvent: store.insertEvent.bind(store),
    getStep: (id) => store.getStep(id) ?? null,
    insertStep: store.insertStep.bind(store)
  }
}

function mutation(requestId: string) {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: `test.${requestId}`,
    payload: { requestId }
  }
}
