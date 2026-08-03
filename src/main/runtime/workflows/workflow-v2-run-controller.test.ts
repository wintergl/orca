import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from '../../../shared/workflow-v2-fixtures'
import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import { listWorkflowV2History } from './workflow-v2-history-store'
import {
  completeWorkflowV2AgentStep,
  completeWorkflowV2DecisionStep
} from './workflow-v2-run-controller'
import { WorkflowStore } from './workflow-store'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-v2-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  openStores.push(store)
  databasePaths.push(path)
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

function assignment(
  paneKey: string,
  lifecycle: string
): Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> {
  return {
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey,
    agentLifecycleId: lifecycle,
    providerSessionId: `session-${lifecycle}`,
    runtimeAgent: 'codex'
  }
}

function surface(store: WorkflowStore) {
  const db = store.persistenceDb
  return {
    db,
    finishEngineStep: (stepRunId: string, envelope: unknown, conclusionMarkdown: string) => {
      db.prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
             delivery_state = CASE WHEN delivery_state = 'prepared' THEN 'delivered'
               ELSE delivery_state END,
             started_at = COALESCE(started_at, datetime('now')),
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
    },
    insertEvent: store.insertEvent.bind(store),
    getStep: store.getStep.bind(store),
    insertStep: store.insertStep.bind(store)
  }
}

function readyV2Run(store: WorkflowStore, templateId: string, slots: [string, string, string][]) {
  const created = store.createRun(
    {
      templateId,
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation(`create-${templateId}`)
  )
  for (const [nodeId, slotId, lifecycle] of slots) {
    store.assignAgent(
      {
        runId: created.id,
        nodeId,
        slotId,
        assignment: assignment(`pane-${lifecycle}`, lifecycle)
      },
      mutation(`assign-${lifecycle}`)
    )
  }
  store.updateRunObjective(
    { runId: created.id, objective: 'Ship a V2 free-form workflow.' },
    mutation(`objective-${templateId}`)
  )
  return store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation(`prepare-${templateId}`)
  ).run.id
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close()
  }
  for (const path of databasePaths.splice(0)) {
    for (const databaseFile of [path, `${path}-wal`, `${path}-shm`]) {
      rmSync(databaseFile, { force: true })
    }
  }
})

describe('Workflow V2 run controller', () => {
  it('runs blank V2 agent → end template', () => {
    const store = createStore()
    const created = store.createTemplate(
      {
        name: 'Blank V2 run',
        scope: 'personal',
        definition: {
          schemaVersion: 2,
          decisionProtocolVersion: 'v2-binary-zh',
          entryStepId: 'agent-1',
          roleSlots: [
            {
              id: 'agent',
              label: 'Agent',
              required: true,
              minAgents: 1,
              maxAgents: 1,
              execution: 'single',
              allowedAgentStates: ['idle']
            }
          ],
          steps: [
            {
              id: 'agent-1',
              name: 'Agent step',
              kind: 'agent',
              roleSlotIds: ['agent'],
              execution: 'single',
              prompt: {
                variants: [
                  {
                    when: 'always',
                    template: '目标：\n{{goal}}\n\n完成条件：\n{{criteria}}'
                  }
                ],
                completionCriteria: 'Done.'
              },
              retryPolicy: { maxAttempts: 1, backoffMs: 0, onExhausted: 'fail-run' },
              next: { targetStepId: 'end' }
            },
            { id: 'end', name: 'Complete', kind: 'end', outcome: 'succeeded' }
          ]
        }
      },
      mutation('create-blank-template')
    )
    const runId = readyV2Run(store, created.id, [['agent-1', 'agent', 'worker']])
    const started = store.beginRun({ runId, baseline: {} }, mutation('start-blank'))
    const step = started.steps.find((candidate) => candidate.nodeId === 'agent-1')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run: started,
      step,
      finalText: 'blank complete'
    })
    expect(store.showRun(runId, 'user-a').status).toBe('completed')
  })

  it('runs single agent → end', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!
    const runId = readyV2Run(store, template.id, [['produce', 'worker', 'worker']])
    const started = store.beginRun({ runId, baseline: { kind: 'test' } }, mutation('start-single'))
    expect(started.status).toBe('running')
    expect(started.currentNodeId).toBe('produce')
    const step = started.steps.find((candidate) => candidate.nodeId === 'produce')!
    const result = completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run: started,
      step,
      finalText: '任务完成：输出已就绪。'
    })
    expect(result.terminal).toBe(true)
    const finished = store.showRun(runId, 'user-a')
    expect(finished.status).toBe('completed')
    const history = listWorkflowV2History(store.persistenceDb, runId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      stepId: 'produce',
      stepKind: 'agent',
      finalText: '任务完成：输出已就绪。'
    })
  })

  it('loops agent → decision false then completes on 完成', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_V2_TEMPLATES[1]!
    const runId = readyV2Run(store, template.id, [
      ['produce', 'producer', 'producer'],
      ['judge', 'judge', 'judge']
    ])
    let run = store.beginRun({ runId, baseline: {} }, mutation('start-loop'))
    let produce = run.steps.find((step) => step.nodeId === 'produce' && step.status === 'queued')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: produce,
      finalText: 'draft v1'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.currentNodeId).toBe('judge')
    let judge = run.steps.find((step) => step.nodeId === 'judge' && step.status === 'queued')!
    completeWorkflowV2DecisionStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: judge,
      finalText: '不完成\n还需要修订'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('running')
    expect(run.currentNodeId).toBe('produce')
    produce = run.steps
      .filter((step) => step.nodeId === 'produce')
      .toSorted((left, right) => right.round - left.round)[0]!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: produce,
      finalText: 'draft v2'
    })
    run = store.showRun(runId, 'user-a')
    judge = run.steps
      .filter((step) => step.nodeId === 'judge')
      .toSorted((left, right) => right.round - left.round)[0]!
    completeWorkflowV2DecisionStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: judge,
      finalText: '完成\n通过'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('completed')
    const history = listWorkflowV2History(store.persistenceDb, runId)
    expect(history.map((entry) => entry.stepId)).toEqual(['produce', 'judge', 'produce', 'judge'])
    expect(history[1]?.decision).toBe(false)
    expect(history[3]?.decision).toBe(true)
  })

  it('chains multi-agent steps and resolves human accept via offers', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_V2_TEMPLATES[2]!
    const runId = readyV2Run(store, template.id, [
      ['research', 'researcher', 'researcher'],
      ['write', 'writer', 'writer'],
      ['judge', 'judge', 'judge']
    ])
    let run = store.beginRun({ runId, baseline: {} }, mutation('start-multi'))
    const research = run.steps.find((step) => step.nodeId === 'research')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: research,
      finalText: 'research notes'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.currentNodeId).toBe('write')
    const write = run.steps.find((step) => step.nodeId === 'write' && step.status === 'queued')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: write,
      finalText: 'draft article'
    })
    run = store.showRun(runId, 'user-a')
    const judge = run.steps.find((step) => step.nodeId === 'judge' && step.status === 'queued')!
    completeWorkflowV2DecisionStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: judge,
      finalText: '不完成\n需人工'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('waiting-human')
    expect(run.currentNodeId).toBe('human')
    expect(run.resolutionContext).toMatchObject({ reviewNodeId: 'human' })
    const accept = run.resolutionOffers.find(
      (offer) => offer.resolutionTransitionId === 'v2-human:accept'
    )
    expect(accept).toMatchObject({
      action: 'approve',
      requiresReason: false,
      requiresConfirmation: true,
      displayLabel: '人工通过'
    })
    run = store.resolveRun(
      { runId, offerId: accept!.id, confirmation: true },
      mutation('human-accept')
    )
    expect(run.status).toBe('completed')
    const history = listWorkflowV2History(store.persistenceDb, runId)
    expect(history.map((entry) => [entry.stepId, entry.stepKind])).toEqual([
      ['research', 'agent'],
      ['write', 'agent'],
      ['judge', 'decision'],
      ['human', 'human']
    ])
  })
})
