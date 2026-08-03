import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import {
  completeWorkflowV2AgentStep,
  completeWorkflowV2DecisionStep,
  type WorkflowV2RuntimeSurface
} from './workflow-v2-run-controller'
import { WorkflowStore } from './workflow-store'

const stores: WorkflowStore[] = []
const paths: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
  for (const path of paths.splice(0)) {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      rmSync(file, { force: true })
    }
  }
})

describe('Workflow V2 route budget extension', () => {
  it('audits an extension and continues the originally exhausted generic route', () => {
    const store = createStore()
    const runId = readyLoopRun(store)
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      run = completeCurrentCycle(store, run, cycle)
    }
    expect(run).toMatchObject({
      status: 'waiting-human',
      currentNodeId: 'human',
      resolutionContext: {
        v2ExhaustedRouteId: 'decision:judge:false',
        v2ExhaustedTargetStepId: 'produce'
      }
    })
    const extension = run.resolutionOffers.find((offer) => offer.action === 'extend-route-budget')!
    run = store.resolveRun(
      {
        runId,
        offerId: extension.id,
        reason: 'Allow one audited correction cycle.',
        routeTraversalBudget: 1,
        confirmation: true
      },
      mutation('extend')
    )
    expect(run.status).toBe('running')
    expect(run.currentNodeId).toBe('produce')
    expect(run.v2RouteBudgetExtensions).toEqual({ 'decision:judge:false': 1 })
    expect(run.v2RouteTraversals).toMatchObject({ 'decision:judge:false': 3 })
    expect(
      run.steps.find((step) => step.nodeId === 'produce' && step.status === 'queued')?.round
    ).toBe(4)
    expect(
      store.runEvents(runId).events.filter((event) => event.type === 'route-budget-extended')
    ).toHaveLength(1)
    const summary = store
      .listRuns({ projectIdentity: 'project-a' }, 'user-a')
      .find((candidate) => candidate.id === runId)
    expect(summary?.businessBudgetSummary).toContain('decision:judge:false: 3/3')
    expect(summary?.businessBudgetSummary).toContain('+1')
    const exported = JSON.parse(store.exportRun(runId, 'json', 'user-a').content) as {
      schema: string
      run: WorkflowRunRecord
      v2History: { stepId: string }[]
    }
    expect(exported.schema).toBe('workflow.run-export/v2')
    expect(exported.run.v2RouteBudgetExtensions).toEqual({ 'decision:judge:false': 1 })
    expect(exported.v2History.map((entry) => entry.stepId)).toEqual([
      'produce',
      'judge',
      'produce',
      'judge',
      'produce',
      'judge'
    ])
  })
})

function completeCurrentCycle(
  store: WorkflowStore,
  current: WorkflowRunRecord,
  cycle: number
): WorkflowRunRecord {
  const produce = current.steps.find(
    (step) => step.nodeId === 'produce' && step.status === 'queued'
  )!
  completeWorkflowV2AgentStep({
    store: surface(store),
    db: store.persistenceDb,
    run: current,
    step: produce,
    finalText: `draft ${cycle}`
  })
  const afterProduce = store.showRun(current.id, 'user-a')
  const judge = afterProduce.steps.find(
    (step) => step.nodeId === 'judge' && step.status === 'queued'
  )!
  completeWorkflowV2DecisionStep({
    store: surface(store),
    db: store.persistenceDb,
    run: afterProduce,
    step: judge,
    finalText: '不完成\ncontinue'
  })
  return store.showRun(current.id, 'user-a')
}

function readyLoopRun(store: WorkflowStore): string {
  const run = store.createRun(
    {
      templateId: 'builtin.v2.agent-decision-loop',
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation('create')
  )
  assign(store, run.id, 'produce', 'producer')
  assign(store, run.id, 'judge', 'judge')
  store.updateRunObjective({ runId: run.id, objective: 'finish' }, mutation('objective'))
  const prepared = store.prepareRun(
    {
      runId: run.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('prepare')
  )
  expect(prepared.ready).toBe(true)
  return run.id
}

function assign(store: WorkflowStore, runId: string, nodeId: string, slotId: string): void {
  store.assignAgent(
    {
      runId,
      nodeId,
      slotId,
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

function surface(store: WorkflowStore): WorkflowV2RuntimeSurface {
  return {
    db: store.persistenceDb,
    finishEngineStep: () => undefined,
    insertEvent: store.insertEvent.bind(store),
    getStep: (id) => store.getStep(id) ?? null,
    insertStep: store.insertStep.bind(store)
  }
}

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-v2-route-extension-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  stores.push(store)
  paths.push(path)
  return store
}

function mutation(requestId: string) {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: `test.${requestId}`,
    payload: { requestId }
  }
}
