import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import {
  digestWorkflowCompletionMessage,
  getWorkflowCompletion,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import {
  reconcileWorkflowStepFailure,
  resumeWorkflowCompletionReconciliations
} from './workflow-completion-failure-reconciler'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { buildWorkflowResolutionOffers } from './workflow-resolution-offers'
import { WorkflowError } from './workflow-error'
import { WorkflowStore } from './workflow-store'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-recon-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  openStores.push(store)
  databasePaths.push(path)
  return store
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

function decideNode(maxAttempts = 2) {
  return {
    id: 'code-decide',
    name: 'Decide',
    type: 'decide' as const,
    roleSlotIds: ['primary'],
    promptTemplateKey: 'builtin.spec.decide.v1' as const,
    retryPolicy: { maxAttempts, backoffMs: 0, onExhausted: 'wait-human' as const },
    promptRules: {
      rules: [
        {
          id: 'first',
          name: 'first',
          when: 'first-visit' as const,
          template: 'decide'
        }
      ],
      completionCriteria: 'done'
    },
    inputBindings: [],
    mode: 'rules' as const,
    outputSchema: 'workflow.decision/v1' as const
  }
}

function produceNode(maxAttempts = 2) {
  return {
    id: 'code-produce',
    name: 'Produce',
    type: 'produce' as const,
    roleSlotIds: ['primary'],
    promptTemplateKey: 'builtin.spec.produce.v1' as const,
    retryPolicy: { maxAttempts, backoffMs: 0, onExhausted: 'wait-human' as const },
    promptRules: {
      rules: [
        {
          id: 'first',
          name: 'first',
          when: 'first-visit' as const,
          template: 'produce'
        }
      ],
      completionCriteria: 'done'
    },
    inputBindings: [],
    artifactKind: 'code' as const,
    outputSchema: 'workflow.completion/v1' as const
  }
}

function makeRunAndStep(
  store: WorkflowStore,
  options?: {
    maxAttempts?: number
    attempt?: number
    nodeKind?: 'decide' | 'produce'
    runId?: string
  }
): { run: WorkflowRunRecord; step: WorkflowStepRunRecord } {
  const nodeKind = options?.nodeKind ?? 'decide'
  const node =
    nodeKind === 'produce'
      ? produceNode(options?.maxAttempts ?? 2)
      : decideNode(options?.maxAttempts ?? 2)
  const runId = options?.runId ?? 'run-recon-1'
  const run = {
    id: runId,
    status: 'running',
    templateSnapshot: {
      nodes: [node],
      transitions: []
    },
    steps: []
  } as unknown as WorkflowRunRecord
  store.persistenceDb
    .prepare(
      `INSERT INTO workflow_runs (
         id, status, version, template_id, template_version, template_name,
         template_snapshot_json, owner_identity, project_identity, workspace_kind,
         workspace_id, execution_host_id, objective
       ) VALUES (?, 'running', 1, 't1', 1, 'T', ?, 'user-a', 'project-a', 'folder-workspace',
         'ws-1', 'local', 'objective')`
    )
    .run(run.id, JSON.stringify(run.templateSnapshot))
  const step = store.insertStep(
    run.id,
    node,
    {
      nodeId: node.id,
      slotId: 'primary',
      agentLifecycleId: 'life-1',
      paneKey: 'pane-1',
      worktreeId: 'ws-1',
      executionHostId: 'local',
      providerSessionId: null,
      runtimeAgent: null
    },
    'artifact-1',
    'running',
    1,
    options?.attempt ?? 1
  )
  store.persistenceDb
    .prepare(`UPDATE workflow_step_runs SET task_id = ?, dispatch_id = ? WHERE id = ?`)
    .run('task-1', 'dispatch-1', step.id)
  const refreshed = store.getStep(step.id)!
  claimWorkflowDispatchOwnership(store.persistenceDb, {
    runId: run.id,
    nodeId: refreshed.nodeId,
    round: refreshed.round,
    assignmentKey: 'primary:life-1',
    stepRunId: refreshed.id,
    attempt: refreshed.attempt,
    taskId: 'task-1',
    dispatchId: 'dispatch-1'
  })
  return {
    run: { ...run, steps: [refreshed] },
    step: refreshed
  }
}

function orchestrationReady(): OrchestrationDb {
  return {
    getWorkerDispatch: vi.fn(() => ({ state: 'ready' })),
    getTask: vi.fn(() => ({ status: 'dispatched' })),
    getDispatchContextById: vi.fn(() => ({ status: 'dispatched' })),
    failWorkerStart: vi.fn(),
    settleWorkerReport: vi.fn(() => ({
      action: 'settled' as const,
      outcome: 'failed' as const,
      duplicate: false
    }))
  } as unknown as OrchestrationDb
}

describe('reconcileWorkflowStepFailure', () => {
  it('settles orchestration then creates exactly one retry via outbox (P0-R1)', () => {
    const store = createStore()
    const { run, step } = makeRunAndStep(store)
    const orchestration = orchestrationReady()

    const first = reconcileWorkflowStepFailure({
      store,
      orchestration,
      run,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'invalid decision')
    })

    expect(first.waitingHuman).toBe(false)
    expect(first.retryStep?.attempt).toBe(2)
    expect(orchestration.settleWorkerReport).toHaveBeenCalled()
    const failed = store.getStep(step.id)!
    expect(failed.status).toBe('failed')
    const retry = store.getStep(first.retryStep!.id)!
    expect(retry.status).toBe('queued')
    expect(retry.attempt).toBe(2)

    const second = reconcileWorkflowStepFailure({
      store,
      orchestration,
      run,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'invalid decision')
    })
    expect(second.duplicate).toBe(true)
    const retries = store.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND attempt = 2`)
      .all(run.id) as { id: string }[]
    expect(retries).toHaveLength(1)
  })

  it('does not auto-retry when ownership cannot be settled', () => {
    const store = createStore()
    const { run, step } = makeRunAndStep(store)
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'start_unknown' })),
      getTask: vi.fn(() => ({ status: 'dispatched' })),
      getDispatchContextById: vi.fn(),
      failWorkerStart: vi.fn(),
      settleWorkerReport: vi.fn()
    } as unknown as OrchestrationDb

    const result = reconcileWorkflowStepFailure({
      store,
      orchestration,
      run,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'ambiguous')
    })

    expect(result.waitingHuman).toBe(true)
    expect(result.retryStep).toBeNull()
    const stillRunning = store.getStep(step.id)!
    expect(stillRunning.status).toBe('running')
  })

  it('resumes mid-flight reconciliation after restart (P0-R3)', () => {
    const store = createStore()
    const { run, step } = makeRunAndStep(store)
    const digest = digestWorkflowCompletionMessage({
      stepRunId: step.id,
      attempt: step.attempt,
      code: 'workflow_completion_incomplete',
      message: 'invalid'
    })
    const { record } = receiveWorkflowCompletion(store.persistenceDb, {
      runId: run.id,
      stepRunId: step.id,
      attempt: step.attempt,
      taskId: step.taskId,
      dispatchId: step.dispatchId,
      messageDigest: digest,
      outcome: 'failed',
      errorCode: 'workflow_completion_incomplete',
      errorMessage: 'invalid'
    })
    expect(record.state).toBe('received')

    const orchestration = orchestrationReady()
    const created = resumeWorkflowCompletionReconciliations({ store, orchestration, run })
    expect(created).toHaveLength(1)
    expect(created[0]!.attempt).toBe(2)
    const settled = getWorkflowCompletion(store.persistenceDb, record.receiptId)!
    expect(settled.state).toBe('settled')
    expect(settled.retryOutboxState).toBe('consumed')
  })

  it('persists successTerminal retry ban via real settlement then close/reopen', () => {
    const path = join(tmpdir(), `orca-workflow-recon-reopen-${randomUUID()}.db`)
    databasePaths.push(path)
    const store = new WorkflowStore(path)
    openStores.push(store)
    // Produce failure after Orchestration success uses failRun (no Review Aggregate required).
    const { run, step } = makeRunAndStep(store, { nodeKind: 'produce', maxAttempts: 2 })
    const successOrch = {
      getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
      getTask: vi.fn(() => ({ status: 'completed' })),
      getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
      failWorkerStart: vi.fn(),
      settleWorkerReport: vi.fn()
    } as unknown as OrchestrationDb
    const first = reconcileWorkflowStepFailure({
      store,
      orchestration: successOrch,
      run,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'missing report after success')
    })
    expect(first.retryStep).toBeNull()
    const mid = getWorkflowCompletion(store.persistenceDb, first.receiptId)!
    expect(mid.retryBlocked).toBe(true)
    // Simulate crash after orchestration-settled but before workflow write by rewinding state.
    // Keep retry_blocked from the real settlement (do not rewrite it).
    store.persistenceDb
      .prepare(
        `UPDATE workflow_completion_reconciliations
         SET state = 'orchestration-settled', retry_outbox_state = 'none',
             updated_at = datetime('now')
         WHERE receipt_id = ?`
      )
      .run(first.receiptId)
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'running', error_code = NULL, error_message = NULL, completed_at = NULL
         WHERE id = ?`
      )
      .run(step.id)
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs SET status = 'running', waiting_reason = NULL, failure_code = NULL
         WHERE id = ?`
      )
      .run(run.id)
    store.close()
    openStores.pop()

    const reopened = new WorkflowStore(path)
    openStores.push(reopened)
    const resumedRun = {
      ...run,
      templateSnapshot: run.templateSnapshot,
      steps: [reopened.getStep(step.id)!]
    } as WorkflowRunRecord
    const orchestration = {
      getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
      getTask: vi.fn(() => ({ status: 'completed' })),
      getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
      failWorkerStart: vi.fn(),
      settleWorkerReport: vi.fn()
    } as unknown as OrchestrationDb
    const created = resumeWorkflowCompletionReconciliations({
      store: reopened,
      orchestration,
      run: resumedRun
    })
    expect(created).toHaveLength(0)
    expect(orchestration.settleWorkerReport).not.toHaveBeenCalled()
    const failed = reopened.getStep(step.id)!
    expect(['failed', 'completion-incomplete']).toContain(failed.status)
    const attemptTwo = reopened.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND attempt = 2`)
      .all(run.id) as { id: string }[]
    expect(attemptTwo).toHaveLength(0)
    const settled = getWorkflowCompletion(reopened.persistenceDb, first.receiptId)!
    expect(settled.retryBlocked).toBe(true)
    expect(settled.retryOutboxState).toBe('none')
  })
})

describe('failWorkflowDecision aggregate invariant', () => {
  it('throws and rolls back when Review Aggregate is missing', () => {
    const store = createStore()
    const { run, step } = makeRunAndStep(store, { maxAttempts: 1 })
    expect(() =>
      store.failDecision({
        run,
        step,
        code: 'workflow_decision_invalid',
        message: 'bad decision',
        recovery: 'inspect',
        skipRetry: true
      })
    ).toThrow('Decision failure cannot bind its Review Aggregate.')
    const unchanged = store.getStep(step.id)!
    expect(unchanged.status).toBe('running')
    expect(unchanged.errorCode).toBeNull()
  })
})

describe('resolveRun retry-with-duplicate-risk', () => {
  it('creates a successor attempt from delivery-uncertain without nested-transaction failure', () => {
    const store = createStore()
    const definition = structuredClone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    const decide = definition.nodes.find((node) => node.type === 'decide')!
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_runs (
           id, status, version, template_id, template_version, template_name,
           template_snapshot_json, owner_identity, project_identity, workspace_kind,
           workspace_id, execution_host_id, objective
         ) VALUES (
           'run-risk-1', 'running', 1, 't1', 1, 'T', ?, 'user-a', 'project-a',
           'folder-workspace', 'ws-1', 'local', 'objective'
         )`
      )
      .run(JSON.stringify(definition))
    const step = store.insertStep(
      'run-risk-1',
      decide,
      {
        nodeId: decide.id,
        slotId: 'primary',
        agentLifecycleId: 'life-1',
        paneKey: 'pane-1',
        worktreeId: 'ws-1',
        executionHostId: 'local',
        providerSessionId: null,
        runtimeAgent: 'codex'
      },
      'artifact-1',
      'running',
      1,
      1
    )
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs SET task_id = 'task-1', dispatch_id = 'dispatch-1' WHERE id = ?`
      )
      .run(step.id)
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs
         SET status = 'waiting-human', waiting_reason = 'delivery-uncertain',
             resolution_context_json = ?, failure_code = 'workflow_delivery_uncertain',
             failure_message = 'uncertain', recovery = 'inspect', version = version + 1,
             updated_at = datetime('now')
         WHERE id = 'run-risk-1'`
      )
      .run(
        JSON.stringify({
          originDecisionStepId: step.id,
          originDecisionNodeId: decide.id,
          reviewNodeId: 'not-yet-created',
          artifactRevisionId: 'artifact-1',
          approveTransitionId: 'run-resolution:unavailable',
          reviseTransitionId: 'run-resolution:retry-step'
        })
      )
    claimWorkflowDispatchOwnership(store.persistenceDb, {
      runId: 'run-risk-1',
      nodeId: decide.id,
      round: 1,
      assignmentKey: 'primary:life-1',
      stepRunId: step.id,
      attempt: 1,
      taskId: 'task-1',
      dispatchId: 'dispatch-1'
    })
    const waiting = store.showRun('run-risk-1', 'user-a')
    const offer = buildWorkflowResolutionOffers(waiting).find(
      (candidate) => candidate.action === 'retry-with-duplicate-risk'
    )
    expect(offer).toBeTruthy()
    const resolved = store.resolveRun(
      {
        runId: 'run-risk-1',
        offerId: offer!.id,
        reason: 'Accept duplicate risk',
        confirmation: true
      },
      {
        callerIdentity: 'user-a',
        requestId: 'risk-retry-1',
        method: 'workflow.runResolve',
        payload: { offerId: offer!.id }
      }
    )
    expect(resolved.status).toBe('running')
    const failed = store.getStep(step.id)!
    expect(failed.status).toBe('failed')
    const successor = resolved.steps.find((candidate) => candidate.attempt === 2)
    expect(successor?.status).toBe('queued')
    expect(successor?.id).not.toBe(step.id)
  })
})

describe('dispatch ownership CAS', () => {
  it('allows only one active owner per logical execution key', () => {
    const store = createStore()
    const first = claimWorkflowDispatchOwnership(store.persistenceDb, {
      runId: 'run-a',
      nodeId: 'node-a',
      round: 1,
      assignmentKey: 'slot:life',
      stepRunId: 'step-1',
      attempt: 1,
      taskId: 'task-1',
      dispatchId: 'dispatch-1'
    })
    expect(first.claimed).toBe(true)
    const second = claimWorkflowDispatchOwnership(store.persistenceDb, {
      runId: 'run-a',
      nodeId: 'node-a',
      round: 1,
      assignmentKey: 'slot:life',
      stepRunId: 'step-2',
      attempt: 2,
      taskId: 'task-2',
      dispatchId: 'dispatch-2'
    })
    expect(second.claimed).toBe(false)
    expect(second.record?.stepRunId).toBe('step-1')
  })
})
