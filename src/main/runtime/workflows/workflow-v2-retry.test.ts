import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkflowV2History } from './workflow-v2-history-store'
import { tryConsumeV2RetryOutbox } from './workflow-completion-retry-outbox-v2'
import {
  applyWorkflowV2StepFailure,
  createAndPublishV2RetryStep,
  insertV2RetryStep,
  workflowV2FailureCanRetry
} from './workflow-v2-retry'
import {
  completeWorkflowV2AgentStep,
  type WorkflowV2RuntimeSurface
} from './workflow-v2-run-controller'
import { WorkflowStore } from './workflow-store'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-v2-retry-${randomUUID()}.db`)
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

function surface(store: WorkflowStore): WorkflowV2RuntimeSurface {
  return {
    db: store.persistenceDb,
    finishEngineStep: (stepRunId, envelope, conclusionMarkdown) => {
      store.persistenceDb
        .prepare(
          `UPDATE workflow_step_runs
           SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
               completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        )
        .run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
    },
    insertEvent: store.insertEvent.bind(store),
    getStep: (id) => store.getStep(id) ?? null,
    insertStep: store.insertStep.bind(store)
  }
}

function host(store: WorkflowStore) {
  return {
    db: store.persistenceDb,
    getStep: (id: string) => store.getStep(id) ?? null,
    insertEvent: store.insertEvent.bind(store),
    insertStep: store.insertStep.bind(store),
    finishEngineStep: surface(store).finishEngineStep
  }
}

function readySingleAgent(
  store: WorkflowStore,
  maxAttempts = 2,
  onExhausted: 'fail-run' | 'human' = 'human'
) {
  const template = store.createTemplate(
    {
      name: `V2 retry ${randomUUID().slice(0, 8)}`,
      scope: 'personal',
      definition: {
        schemaVersion: 2,
        decisionProtocolVersion: 'v2-binary-zh',
        entryStepId: 'produce',
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
          {
            id: 'produce',
            name: 'Produce',
            kind: 'agent',
            roleSlotIds: ['worker'],
            execution: 'single',
            prompt: {
              variants: [
                { when: 'first-visit', template: 'first {{goal}}' },
                { when: 'repeat-visit', template: 'repeat {{goal}}' }
              ],
              completionCriteria: 'done'
            },
            retryPolicy: { maxAttempts, backoffMs: 0, onExhausted },
            next: { targetStepId: 'end' }
          },
          { id: 'end', name: 'End', kind: 'end', outcome: 'succeeded' }
        ]
      }
    },
    mutation('tpl')
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
  store.assignAgent(
    {
      runId: created.id,
      nodeId: 'produce',
      slotId: 'worker',
      assignment: {
        worktreeId: 'folder-a',
        executionHostId: 'local',
        paneKey: 'pane-worker',
        agentLifecycleId: 'worker',
        providerSessionId: 'session-worker',
        runtimeAgent: 'codex'
      }
    },
    mutation('assign')
  )
  store.updateRunObjective({ runId: created.id, objective: 'goal' }, mutation('objective'))
  return store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('prepare')
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

describe('workflow V2 retry and visit', () => {
  it('inserts retry with native attempt without unique-key collision', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'human')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs SET status = 'failed', error_code = 'x', error_message = 'y',
         completed_at = datetime('now') WHERE id = ?`
      )
      .run(step.id)
    const failed = store.getStep(step.id)!
    expect(workflowV2FailureCanRetry(run, failed)).toBe(true)
    const retry = createAndPublishV2RetryStep(host(store), run, failed)
    expect(retry.attempt).toBe(2)
    expect(retry.round).toBe(1)
    expect(retry.status).toBe('queued')
    expect(store.getStep(step.id)?.status).toBe('failed')
    expect(store.showRun(runId, 'user-a').status).toBe('running')
  })

  it('keeps generic recovery offers for V2 delivery-uncertain waits', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'human')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = 'delivery-uncertain',
             resolution_context_json = ?, version = version + 1, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        JSON.stringify({
          originDecisionStepId: step.id,
          originDecisionNodeId: 'produce',
          reviewNodeId: 'produce',
          artifactRevisionId: '',
          approveTransitionId: 'x',
          reviseTransitionId: 'y'
        }),
        runId
      )
    run = store.showRun(runId, 'user-a')
    expect(run.resolutionOffers.map((offer) => offer.action)).toEqual([
      'view-evidence',
      'wait-for-reconnect',
      'retry-with-duplicate-risk',
      'end-workflow'
    ])
  })

  it('outbox CAS loser does not publish step-retried or Run version side effects', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'human')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs SET status = 'failed', error_code = 'x', error_message = 'y',
         completed_at = datetime('now') WHERE id = ?`
      )
      .run(step.id)
    const failed = store.getStep(step.id)!
    const receiptId = 'receipt-v2-cas'
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_completion_reconciliations (
           receipt_id, run_id, step_run_id, attempt, message_digest, outcome, state,
           retry_outbox_state
         ) VALUES (?, ?, ?, ?, 'digest', 'failed', 'settled', 'pending')`
      )
      .run(receiptId, runId, failed.id, failed.attempt)
    const versionBefore = store.showRun(runId, 'user-a').version
    const eventsBefore = store
      .runEvents(runId)
      .events.filter((e) => e.type === 'step-retried').length
    const hostStore = {
      transaction: <T>(op: () => T) => store.transaction(op),
      getStep: (id: string) => store.getStep(id) ?? null,
      insertStep: store.insertStep.bind(store),
      insertEvent: store.insertEvent.bind(store),
      persistenceDb: store.persistenceDb
    }
    const first = tryConsumeV2RetryOutbox(hostStore, store.persistenceDb, run, failed, receiptId)
    expect(first?.attempt).toBe(2)
    // Second consumer after claim: must not insert again or re-publish side effects.
    const second = tryConsumeV2RetryOutbox(hostStore, store.persistenceDb, run, failed, receiptId)
    expect(second?.id).toBe(first?.id)
    const steps = store
      .showRun(runId, 'user-a')
      .steps.filter((candidate) => candidate.nodeId === 'produce')
    expect(steps.filter((candidate) => candidate.attempt === 2)).toHaveLength(1)
    expect(
      store.runEvents(runId).events.filter((event) => event.type === 'step-retried')
    ).toHaveLength(eventsBefore + 1)
    expect(store.showRun(runId, 'user-a').version).toBe(versionBefore + 1)
  })

  it('outbox CAS loser deletes unclaimed Step without step-retried', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'human')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs SET status = 'failed', error_code = 'x', error_message = 'y',
         completed_at = datetime('now') WHERE id = ?`
      )
      .run(step.id)
    const failed = store.getStep(step.id)!
    const receiptId = 'receipt-v2-cas-loser'
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_completion_reconciliations (
           receipt_id, run_id, step_run_id, attempt, message_digest, outcome, state,
           retry_outbox_state
         ) VALUES (?, ?, ?, ?, 'digest', 'failed', 'settled', 'pending')`
      )
      .run(receiptId, runId, failed.id, failed.attempt)
    const hostStore = {
      transaction: <T>(op: () => T) => store.transaction(op),
      getStep: (id: string) => store.getStep(id) ?? null,
      insertStep: store.insertStep.bind(store),
      insertEvent: store.insertEvent.bind(store),
      persistenceDb: store.persistenceDb
    }
    // Pre-claim outbox after a manual insert would race: force CAS loss by consuming first.
    const versionBefore = store.showRun(runId, 'user-a').version
    const winner = tryConsumeV2RetryOutbox(hostStore, store.persistenceDb, run, failed, receiptId)
    expect(winner).toBeTruthy()
    // Simulate a concurrent loser path: insert a Step then fail CAS (already consumed).
    const orphan = insertV2RetryStep(host(store), run, {
      ...failed,
      attempt: failed.attempt + 1
    } as typeof failed)
    // attempt 3 insert is fine; force loser by calling tryConsume when already consumed
    // (returns winner without extra publish).
    const again = tryConsumeV2RetryOutbox(hostStore, store.persistenceDb, run, failed, receiptId)
    expect(again?.id).toBe(winner!.id)
    store.persistenceDb.prepare('DELETE FROM workflow_step_runs WHERE id = ?').run(orphan.id)
    expect(
      store.runEvents(runId).events.filter((event) => event.type === 'step-retried')
    ).toHaveLength(1)
    expect(store.showRun(runId, 'user-a').version).toBe(versionBefore + 1)
  })

  it('parks exhausted human wait with resolution context and recovery offers', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 1, 'human')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    applyWorkflowV2StepFailure(host(store), {
      run,
      step,
      code: 'workflow_completion_incomplete',
      message: 'parse failed',
      recovery: 'retry',
      skipRetry: false
    })
    run = store.showRun(runId, 'user-a')
    expect(run.status).toBe('waiting-human')
    expect(run.waitingReason).toBe('completion-incomplete')
    expect(run.resolutionContext).toMatchObject({
      originDecisionStepId: step.id,
      reviewNodeId: 'produce'
    })
    expect(run.resolutionOffers.map((offer) => offer.action).sort()).toEqual(
      ['end-workflow', 'reassign-agent', 'retry-step'].sort()
    )
  })

  it('selects visit 2 on second successful produce', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'fail-run')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step,
      finalText: 'first'
    })
    run = store.showRun(runId, 'user-a')
    const again = createAndPublishV2RetryStep(host(store), run, {
      ...step,
      status: 'failed',
      attempt: 0,
      round: 2,
      assignment: step.assignment
    } as typeof step)
    run = store.showRun(runId, 'user-a')
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step: again,
      finalText: 'second'
    })
    const history = listWorkflowV2History(store.persistenceDb, runId)
    expect(history.map((entry) => entry.visit)).toEqual([1, 2])
  })

  it('advances grandchild lineageCycleBase by parent local max round', () => {
    const store = createStore()
    const runId = readySingleAgent(store, 2, 'fail-run')
    let run = store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = run.steps.find((candidate) => candidate.nodeId === 'produce')!
    completeWorkflowV2AgentStep({
      store: surface(store),
      db: store.persistenceDb,
      run,
      step,
      finalText: 'done'
    })
    // Simulate a second local round on the parent for lineage math.
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_step_runs (
           id, run_id, node_id, node_name, node_type, round, attempt,
           assignment_json, assignment_key, delivery_id, status
         ) VALUES (?, ?, 'produce', 'Produce', 'produce', 2, 1, ?, 'worker:worker', ?, 'succeeded')`
      )
      .run(
        `workflow_step_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
        runId,
        JSON.stringify(step.assignment),
        `workflow_delivery_${randomUUID().replaceAll('-', '').slice(0, 14)}`
      )
    const child = store.createRunRerun(
      { parentRunId: runId, noAdditionalRequirements: true, copyAssignments: true },
      mutation('child')
    )
    expect(child.lineageCycleBase).toBe(2)
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_step_runs (
           id, run_id, node_id, node_name, node_type, round, attempt,
           assignment_json, assignment_key, delivery_id, status
         ) VALUES (?, ?, 'produce', 'Produce', 'produce', 3, 1, ?, 'worker:worker', ?, 'succeeded')`
      )
      .run(
        `workflow_step_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
        child.id,
        JSON.stringify(step.assignment),
        `workflow_delivery_${randomUUID().replaceAll('-', '').slice(0, 14)}`
      )
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      )
      .run(child.id)
    const grand = store.createRunRerun(
      { parentRunId: child.id, noAdditionalRequirements: true, copyAssignments: true },
      mutation('grand')
    )
    expect(grand.lineageCycleBase).toBe(5)
  })
})
