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

  it('loops code writing and review after a negative decision, then completes', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_V2_TEMPLATES[1]!
    const runId = readyV2Run(store, template.id, [
      ['code-produce', 'code-author', 'code-author'],
      ['code-review', 'code-reviewers', 'code-reviewer'],
      ['code-decide', 'code-decider', 'code-decider']
    ])
    let run = store.beginRun({ runId, baseline: {} }, mutation('start-loop'))
    let produce = run.steps.find(
      (step) => step.nodeId === 'code-produce' && step.status === 'queued'
    )!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: produce,
      finalText: 'draft v1'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.currentNodeId).toBe('code-review')
    let review = run.steps.find(
      (step) => step.nodeId === 'code-review' && step.status === 'queued'
    )!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: review,
      finalText: '发现阻塞项'
    })
    run = store.showRun(runId, 'user-a')
    let judge = run.steps.find((step) => step.nodeId === 'code-decide' && step.status === 'queued')!
    completeWorkflowV2DecisionStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: judge,
      finalText: '不完成\n还需要修订'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('running')
    expect(run.currentNodeId).toBe('code-produce')
    produce = run.steps
      .filter((step) => step.nodeId === 'code-produce')
      .toSorted((left, right) => right.round - left.round)[0]!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: produce,
      finalText: 'draft v2'
    })
    run = store.showRun(runId, 'user-a')
    review = run.steps
      .filter((step) => step.nodeId === 'code-review')
      .toSorted((left, right) => right.round - left.round)[0]!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: review,
      finalText: '阻塞项已关闭'
    })
    run = store.showRun(runId, 'user-a')
    judge = run.steps
      .filter((step) => step.nodeId === 'code-decide')
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
    expect(history.map((entry) => entry.stepId)).toEqual([
      'code-produce',
      'code-review',
      'code-decide',
      'code-produce',
      'code-review',
      'code-decide'
    ])
    expect(history[2]?.decision).toBe(false)
    expect(history[5]?.decision).toBe(true)
  })

  it('fans out SPEC review and resolves an invalid decision by human approval', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!
    const runId = readyV2Run(store, template.id, [
      ['spec-produce', 'spec-author', 'spec-author'],
      ['spec-review', 'spec-reviewers', 'spec-reviewer-a'],
      ['spec-review', 'spec-reviewers', 'spec-reviewer-b'],
      ['spec-decide', 'spec-decider', 'spec-decider']
    ])
    let run = store.beginRun({ runId, baseline: {} }, mutation('start-multi'))
    const research = run.steps.find((step) => step.nodeId === 'spec-produce')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: research,
      finalText: 'SPEC 第一版'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.currentNodeId).toBe('spec-review')
    const writers = run.steps.filter(
      (step) => step.nodeId === 'spec-review' && step.status === 'queued'
    )
    expect(writers).toHaveLength(2)
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: writers[0]!,
      finalText: '评审意见 A'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.currentNodeId).toBe('spec-review')
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: writers[1]!,
      finalText: '评审意见 B'
    })
    run = store.showRun(runId, 'user-a')
    const judge = run.steps.find(
      (step) => step.nodeId === 'spec-decide' && step.status === 'queued'
    )!
    completeWorkflowV2DecisionStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: judge,
      finalText: '请求人工确认'
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('waiting-human')
    expect(run.currentNodeId).toBe('spec-human')
    expect(run.resolutionContext).toMatchObject({ reviewNodeId: 'spec-human' })
    const accept = run.resolutionOffers.find(
      (offer) => offer.resolutionTransitionId === 'v2-human:approve'
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
      ['spec-produce', 'agent'],
      ['spec-review', 'agent'],
      ['spec-decide', 'decision'],
      ['spec-human', 'human']
    ])
    expect(history.find((entry) => entry.stepId === 'spec-review')?.agentOutputs).toHaveLength(2)
  })
})
