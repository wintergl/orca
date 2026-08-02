import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowArtifactRevision,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  getWorkflowCompletion,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import { listUnsettledCompletionRunOwners } from './workflow-completion-reconciliation-queries'
import {
  reconcileWorkflowStepFailure,
  resumeWorkflowCompletionReconciliations
} from './workflow-completion-failure-reconciler'
import {
  reconcileWorkflowStepSuccess,
  resumeWorkflowSuccessCompletions
} from './workflow-completion-success-reconciler'
import * as workerDoneModule from './workflow-completion-worker-done'
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { WorkflowError } from './workflow-error'
import { WorkflowStore } from './workflow-store'
import { createWorkflowReliabilityTables } from './workflow-database-reliability-schema'
import Database from '../../sqlite/sync-database'

const freezeMock = vi.hoisted(() =>
  vi.fn(
    async (params: {
      store: WorkflowStore
      run: WorkflowRunRecord
      step: WorkflowStepRunRecord
    }): Promise<WorkflowArtifactRevision> =>
      params.store.saveArtifact({
        runId: params.run.id,
        kind: 'code',
        executionHostId: 'local',
        worktreeId: 'ws-1',
        locator: { paths: ['a.ts'] },
        digest: `digest-${params.step.id}`,
        manifest: {
          schema: 'workflow.artifact-manifest/v1',
          executionHostId: 'local',
          workspaceId: 'ws-1',
          entries: []
        },
        snapshotState: 'frozen',
        producedByStepRunId: params.step.id,
        materializedPath: null
      })
  )
)

vi.mock('./workflow-artifact-store', () => ({
  freezeWorkflowArtifact: freezeMock
}))

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  freezeMock.mockClear()
  freezeMock.mockImplementation(
    async (params: { store: WorkflowStore; run: WorkflowRunRecord; step: WorkflowStepRunRecord }) =>
      params.store.saveArtifact({
        runId: params.run.id,
        kind: 'code',
        executionHostId: 'local',
        worktreeId: 'ws-1',
        locator: { paths: ['a.ts'] },
        digest: `digest-${params.step.id}`,
        manifest: {
          schema: 'workflow.artifact-manifest/v1',
          executionHostId: 'local',
          workspaceId: 'ws-1',
          entries: []
        },
        snapshotState: 'frozen',
        producedByStepRunId: params.step.id,
        materializedPath: null
      })
  )
  for (const store of openStores.splice(0)) {
    store.close()
  }
  for (const path of databasePaths.splice(0)) {
    for (const databaseFile of [path, `${path}-wal`, `${path}-shm`]) {
      rmSync(databaseFile, { force: true })
    }
  }
})

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-success-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  openStores.push(store)
  databasePaths.push(path)
  return store
}

function produceNode() {
  return {
    id: 'code-produce',
    name: 'Produce',
    type: 'produce' as const,
    roleSlotIds: ['primary'],
    promptTemplateKey: 'builtin.spec.produce.v1' as const,
    retryPolicy: { maxAttempts: 2, backoffMs: 0, onExhausted: 'wait-human' as const },
    promptRules: {
      rules: [{ id: 'first', name: 'first', when: 'first-visit' as const, template: 'produce' }],
      completionCriteria: 'done'
    },
    inputBindings: [],
    artifactKind: 'code' as const,
    outputSchema: 'workflow.completion/v1' as const
  }
}

function reviewNode() {
  return {
    id: 'code-review',
    name: 'Review',
    type: 'review' as const,
    roleSlotIds: ['reviewer'],
    promptTemplateKey: 'builtin.spec.review.v1' as const,
    retryPolicy: { maxAttempts: 1, backoffMs: 0, onExhausted: 'wait-human' as const },
    promptRules: {
      rules: [{ id: 'first', name: 'first', when: 'first-visit' as const, template: 'review' }],
      completionCriteria: 'done'
    },
    inputBindings: [],
    reviewPolicy: {
      minReviewers: 1,
      timeoutMs: 60_000,
      aggregation: 'all-approve' as const
    },
    outputSchema: 'workflow.review-result/v1' as const
  }
}

function seedProduceRun(
  store: WorkflowStore,
  options?: { withReviewFanOut?: boolean; runStatus?: string }
): { run: WorkflowRunRecord; step: WorkflowStepRunRecord } {
  const produce = produceNode()
  const review = reviewNode()
  const withReview = options?.withReviewFanOut ?? false
  const templateSnapshot = {
    nodes: withReview ? [produce, review] : [produce],
    transitions: withReview
      ? [
          {
            id: 'produce-to-review',
            from: produce.id,
            to: review.id,
            when: 'step:succeeded' as const
          }
        ]
      : []
  }
  const runId = `run-success-${randomUUID().slice(0, 8)}`
  store.persistenceDb
    .prepare(
      `INSERT INTO workflow_runs (
         id, status, version, template_id, template_version, template_name,
         template_snapshot_json, owner_identity, project_identity, workspace_kind,
         workspace_id, execution_host_id, objective, current_node_id
       ) VALUES (?, ?, 1, 't1', 1, 'T', ?, 'user-a', 'project-a', 'folder-workspace',
         'ws-1', 'local', 'objective', ?)`
    )
    .run(runId, options?.runStatus ?? 'running', JSON.stringify(templateSnapshot), produce.id)
  const assignment = {
    nodeId: produce.id,
    slotId: 'primary',
    agentLifecycleId: 'life-1',
    paneKey: 'pane-1',
    worktreeId: 'ws-1',
    executionHostId: 'local',
    providerSessionId: null,
    runtimeAgent: null
  }
  const step = store.insertStep(runId, produce, assignment, null, 'running', 1, 1)
  store.persistenceDb
    .prepare(`UPDATE workflow_step_runs SET task_id = ?, dispatch_id = ? WHERE id = ?`)
    .run('task-1', 'dispatch-1', step.id)
  const refreshed = store.getStep(step.id)!
  claimWorkflowDispatchOwnership(store.persistenceDb, {
    runId,
    nodeId: refreshed.nodeId,
    round: refreshed.round,
    assignmentKey: 'primary:life-1',
    stepRunId: refreshed.id,
    attempt: refreshed.attempt,
    taskId: 'task-1',
    dispatchId: 'dispatch-1'
  })
  const run = {
    id: runId,
    status: options?.runStatus ?? 'running',
    version: 1,
    templateSnapshot,
    currentNodeId: produce.id,
    steps: [refreshed],
    reviewAggregates: [],
    decisions: [],
    assignments: withReview
      ? [
          {
            nodeId: review.id,
            slotId: 'reviewer',
            agentLifecycleId: 'life-review',
            paneKey: 'pane-r',
            worktreeId: 'ws-1',
            executionHostId: 'local',
            providerSessionId: null,
            runtimeAgent: null
          }
        ]
      : [],
    reviewRoundsByNodeId: {},
    workspace: { kind: 'folder-workspace', id: 'ws-1' },
    executionHostId: 'local',
    orchestrationRunId: 'orch-run-1'
  } as unknown as WorkflowRunRecord
  return { run, step: refreshed }
}

function completionEnvelope(runId: string, stepId: string) {
  return {
    schema: 'workflow.completion/v1' as const,
    taskId: 'task-1',
    dispatchId: 'dispatch-1',
    workflowRunId: runId,
    stepRunId: stepId,
    agentLifecycleId: 'life-1',
    providerSessionId: null,
    executionHostId: 'local',
    outcome: 'succeeded' as const,
    summary: 'done',
    finalConclusionMarkdown: 'Produce complete.',
    artifacts: [{ kind: 'code' as const, locator: { paths: ['a.ts'] } }],
    validations: [],
    unresolved: [],
    readyForNextStep: true
  }
}

function preparedFor(runId: string, stepId: string, messageId = `msg-${randomUUID().slice(0, 8)}`) {
  const value = completionEnvelope(runId, stepId)
  return {
    value,
    source: 'report-path' as const,
    digest: `sha-${messageId}`,
    sourceIdentity: 'agent',
    sourceReference: { reportPath: `/tmp/${stepId}.json`, preparedAt: new Date().toISOString() },
    warnings: [] as string[],
    filesModified: ['a.ts'],
    reportPath: `/tmp/${stepId}.json`
  }
}

function runtimeStub(): OrcaRuntimeService {
  return {
    resolveTerminalPane: vi.fn(() => ({ handle: 'agent-handle' })),
    notifyMessageArrived: vi.fn()
  } as unknown as OrcaRuntimeService
}

function orchSucceeded(messageById: Map<string, { id: string }> = new Map()): OrchestrationDb {
  return {
    getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
    getTask: vi.fn(() => ({ status: 'completed' })),
    getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
    getRunMailboxHistory: vi.fn(() => []),
    getMessageById: vi.fn((id: string) => messageById.get(id)),
    failWorkerStart: vi.fn(),
    settleWorkerReport: vi.fn(),
    insertMessage: vi.fn()
  } as unknown as OrchestrationDb
}

function orchFailedTerminal(): OrchestrationDb {
  return {
    getWorkerDispatch: vi.fn(() => ({ state: 'failed' })),
    getTask: vi.fn(() => ({ status: 'failed' })),
    getDispatchContextById: vi.fn(() => ({ status: 'failed' })),
    getRunMailboxHistory: vi.fn(() => []),
    getMessageById: vi.fn(() => undefined),
    failWorkerStart: vi.fn(),
    settleWorkerReport: vi.fn(),
    insertMessage: vi.fn()
  } as unknown as OrchestrationDb
}

describe('reconcileWorkflowStepSuccess', () => {
  it('settles produce success and creates a single downstream review step', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { withReviewFanOut: true })
    const prepared = preparedFor(run.id, step.id)
    const first = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run,
      step,
      prepared
    })
    expect(first.conflict).toBe(false)
    expect(first.nextNodeId).toBe('code-review')
    expect(freezeMock).toHaveBeenCalledOnce()
    const receipt = getWorkflowCompletion(store.persistenceDb, first.receiptId)!
    expect(receipt.state).toBe('settled')
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.successPayload?.artifactRevisionId).toBeTruthy()
    expect(store.getStep(step.id)?.status).toBe('succeeded')

    const second = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run,
      step,
      prepared
    })
    expect(second.duplicate).toBe(true)
    expect(second.conflict).toBe(false)
    const reviewSteps = store.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND node_id = 'code-review'`)
      .all(run.id) as { id: string }[]
    expect(reviewSteps).toHaveLength(1)
  })

  it('freezes artifact only after claiming the success receipt', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const order: string[] = []
    freezeMock.mockImplementationOnce(async (params) => {
      order.push('freeze')
      const receipts = params.store.persistenceDb
        .prepare(
          `SELECT outcome, state FROM workflow_completion_reconciliations
           WHERE step_run_id = ? AND attempt = ?`
        )
        .get(params.step.id, params.step.attempt) as { outcome: string; state: string }
      expect(receipts.outcome).toBe('succeeded')
      expect(['received', 'orchestration-settled']).toContain(receipts.state)
      return params.store.saveArtifact({
        runId: params.run.id,
        kind: 'code',
        executionHostId: 'local',
        worktreeId: 'ws-1',
        locator: { paths: ['a.ts'] },
        digest: `digest-${params.step.id}`,
        manifest: {
          schema: 'workflow.artifact-manifest/v1',
          executionHostId: 'local',
          workspaceId: 'ws-1',
          entries: []
        },
        snapshotState: 'frozen',
        producedByStepRunId: params.step.id,
        materializedPath: null
      })
    })
    order.push('reconcile-start')
    await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    expect(order[0]).toBe('reconcile-start')
    expect(order).toContain('freeze')
  })

  it('resumes from orchestration-settled after crash without a second downstream step', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { withReviewFanOut: true })
    const prepared = preparedFor(run.id, step.id)
    const first = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run,
      step,
      prepared
    })
    store.persistenceDb
      .prepare(
        `UPDATE workflow_completion_reconciliations
         SET state = 'orchestration-settled', resolution = 'none', updated_at = datetime('now')
         WHERE receipt_id = ?`
      )
      .run(first.receiptId)
    store.close()
    openStores.pop()

    const path = databasePaths.at(-1)!
    const reopened = new WorkflowStore(path)
    openStores.push(reopened)
    const resumedRun = {
      ...run,
      steps: [reopened.getStep(step.id)!],
      assignments: run.assignments
    } as WorkflowRunRecord
    await resumeWorkflowSuccessCompletions({
      store: reopened,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: resumedRun
    })
    const settled = getWorkflowCompletion(reopened.persistenceDb, first.receiptId)!
    expect(settled.state).toBe('settled')
    const reviewSteps = reopened.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND node_id = 'code-review'`)
      .all(run.id) as { id: string }[]
    expect(reviewSteps).toHaveLength(1)
  })

  it('fail-closes when Orchestration failure terminal races a success receipt', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const result = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchFailedTerminal(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    expect(result.conflict).toBe(true)
    const receipt = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(receipt.state).toBe('settled')
    expect(receipt.resolution).toBe('conflict-fail-close')
    expect(receipt.retryBlocked).toBe(true)
    expect(receipt.errorCode).toBe('workflow_outcome_conflict')
    expect(store.getStep(step.id)?.status).not.toBe('running')
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchFailedTerminal(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord
    })
    expect(getWorkflowCompletion(store.persistenceDb, result.receiptId)?.state).toBe('settled')
    expect(freezeMock).not.toHaveBeenCalled()
  })

  it('does not apply success after crash with conflict-fail-close resolution', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const prepared = preparedFor(run.id, step.id)
    const received = receiveWorkflowCompletion(store.persistenceDb, {
      runId: run.id,
      stepRunId: step.id,
      attempt: step.attempt,
      taskId: step.taskId,
      dispatchId: step.dispatchId,
      messageDigest: prepared.digest,
      outcome: 'succeeded',
      successPayload: {
        nodeType: 'produce',
        value: prepared.value,
        source: prepared.source,
        sourceIdentity: prepared.sourceIdentity,
        sourceReference: prepared.sourceReference,
        warnings: prepared.warnings,
        conclusionMarkdown: 'Produce complete.',
        filesModified: prepared.filesModified,
        artifactRevisionId: null
      }
    })
    store.persistenceDb
      .prepare(
        `UPDATE workflow_completion_reconciliations
         SET state = 'orchestration-settled',
             resolution = 'conflict-fail-close',
             retry_blocked = 1,
             error_code = 'workflow_outcome_conflict',
             error_message = 'partial conflict write',
             updated_at = datetime('now')
         WHERE receipt_id = ?`
      )
      .run(received.record.receiptId)
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord
    })
    const settled = getWorkflowCompletion(store.persistenceDb, received.record.receiptId)!
    expect(settled.state).toBe('settled')
    expect(settled.resolution).toBe('conflict-fail-close')
    expect(store.getStep(step.id)?.status).not.toBe('succeeded')
    expect(freezeMock).not.toHaveBeenCalled()
  })

  it('fail-closes deterministic post-receipt freeze errors', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    freezeMock.mockRejectedValueOnce(
      new WorkflowError('workflow_artifact_unavailable', 'no files to freeze')
    )
    const result = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    expect(result.conflict).toBe(false)
    const receipt = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(receipt.state).toBe('settled')
    expect(receipt.resolution).toBe('post-receipt-fail-close')
    expect(store.getStep(step.id)?.status).not.toBe('running')
  })

  it('lets success win when it claims the attempt first', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const success = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    expect(success.conflict).toBe(false)
    const failure = reconcileWorkflowStepFailure({
      store,
      orchestration: orchSucceeded(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'late failure')
    })
    expect(failure.conflict).toBe(true)
    expect(failure.receiptId).toBe(success.receiptId)
    expect(store.getStep(step.id)?.status).toBe('succeeded')
  })

  it('lets failure win when it claims the attempt first', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const failure = reconcileWorkflowStepFailure({
      store,
      orchestration: {
        getWorkerDispatch: vi.fn(() => ({ state: 'ready' })),
        getTask: vi.fn(() => ({ status: 'dispatched' })),
        getDispatchContextById: vi.fn(() => ({ status: 'dispatched' })),
        failWorkerStart: vi.fn(),
        settleWorkerReport: vi.fn(() => ({
          action: 'settled' as const,
          outcome: 'failed' as const,
          duplicate: false
        }))
      } as unknown as OrchestrationDb,
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'early failure')
    })
    expect(failure.conflict).toBe(false)
    const success = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    expect(success.conflict).toBe(true)
    expect(success.receiptId).toBe(failure.receiptId)
    const rows = store.persistenceDb
      .prepare(
        `SELECT outcome FROM workflow_completion_reconciliations
         WHERE run_id = ? AND step_run_id = ? AND attempt = ?`
      )
      .all(run.id, step.id, step.attempt) as { outcome: string }[]
    expect(rows).toEqual([{ outcome: 'failed' }])
  })

  it('resumes unsettled success even when the Run is already completed', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'completed' })
    const prepared = preparedFor(run.id, step.id)
    const received = receiveWorkflowCompletion(store.persistenceDb, {
      runId: run.id,
      stepRunId: step.id,
      attempt: step.attempt,
      taskId: step.taskId,
      dispatchId: step.dispatchId,
      messageDigest: prepared.digest,
      outcome: 'succeeded',
      successPayload: {
        nodeType: 'produce',
        value: prepared.value,
        source: prepared.source,
        sourceIdentity: prepared.sourceIdentity,
        sourceReference: prepared.sourceReference,
        warnings: [],
        conclusionMarkdown: 'Produce complete.',
        filesModified: [],
        artifactRevisionId: null
      }
    })
    store.persistenceDb
      .prepare(`UPDATE workflow_runs SET status = 'completed' WHERE id = ?`)
      .run(run.id)
    expect(
      listUnsettledCompletionRunOwners(store.persistenceDb).some((owner) => owner.runId === run.id)
    ).toBe(true)
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'completed' } as WorkflowRunRecord
    })
    expect(getWorkflowCompletion(store.persistenceDb, received.record.receiptId)?.state).toBe(
      'settled'
    )
    expect(store.getStep(step.id)?.status).toBe('succeeded')
  })

  it('migrates resolution onto legacy reconciliation tables', () => {
    const path = join(tmpdir(), `orca-workflow-res-mig-${randomUUID()}.db`)
    databasePaths.push(path)
    const db = new Database(path)
    db.exec(`
      CREATE TABLE workflow_completion_reconciliations (
        receipt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_run_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        task_id TEXT,
        dispatch_id TEXT,
        message_digest TEXT NOT NULL,
        outcome TEXT NOT NULL,
        state TEXT NOT NULL,
        retry_outbox_state TEXT NOT NULL DEFAULT 'none',
        retry_step_run_id TEXT,
        retry_blocked INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        success_payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, step_run_id, attempt)
      );
    `)
    createWorkflowReliabilityTables(db)
    const columns = db.prepare(`PRAGMA table_info(workflow_completion_reconciliations)`).all() as {
      name: string
    }[]
    expect(columns.some((column) => column.name === 'resolution')).toBe(true)
    db.close()
  })

  it('fail-closes deterministic received-phase lifecycle rejection without outer failure path', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    vi.spyOn(workerDoneModule, 'settleOrchestrationViaInternalWorkerDone').mockImplementationOnce(
      () => {
        throw new WorkflowError(
          'workflow_completion_incomplete',
          'Workflow result completion was rejected: sender_not_assignee'
        )
      }
    )
    const result = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    const receipt = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(receipt.state).toBe('settled')
    expect(receipt.resolution).toBe('post-receipt-fail-close')
    expect(store.getStep(step.id)?.status).not.toBe('running')
  })

  it('parks received-phase transient insert errors as waiting-human on the same receipt', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { withReviewFanOut: true, runStatus: 'running' })
    vi.spyOn(workerDoneModule, 'settleOrchestrationViaInternalWorkerDone').mockImplementationOnce(
      () => {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
      }
    )
    const result = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    const receipt = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(receipt.state).toBe('received')
    expect(receipt.resolution).toBe('waiting-human')
    const parked = store.persistenceDb
      .prepare(`SELECT status, waiting_reason, failure_code FROM workflow_runs WHERE id = ?`)
      .get(run.id) as { status: string; waiting_reason: string; failure_code: string }
    expect(parked).toMatchObject({
      status: 'waiting-human',
      waiting_reason: 'delivery-uncertain'
    })
    // Next resume restores Run and completes (must pass the parked Run, as recover does).
    const parkedRun = { ...run, status: 'waiting-human', waitingReason: 'delivery-uncertain' }
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: parkedRun as WorkflowRunRecord
    })
    const settled = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(settled.state).toBe('settled')
    expect(settled.resolution).toBe('none')
    expect(settled.errorCode).toBeNull()
    const restored = store.persistenceDb
      .prepare(
        `SELECT status, waiting_reason, failure_code, recovery, resolution_context_json
         FROM workflow_runs WHERE id = ?`
      )
      .get(run.id) as {
      status: string
      waiting_reason: string | null
      failure_code: string | null
      recovery: string | null
      resolution_context_json: string | null
    }
    expect(restored.status).toBe('running')
    expect(restored.waiting_reason).toBeNull()
    expect(restored.failure_code).toBeNull()
    expect(restored.recovery).toBeNull()
    expect(restored.resolution_context_json).toBeNull()
  })
})

describe('resumeWorkflowCompletionReconciliations coexistence', () => {
  it('does not advance success workflow-settled receipts', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store, { runStatus: 'paused' })
    const success = await reconcileWorkflowStepSuccess({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord,
      step,
      prepared: preparedFor(run.id, step.id)
    })
    store.persistenceDb
      .prepare(
        `UPDATE workflow_completion_reconciliations
         SET state = 'workflow-settled' WHERE receipt_id = ?`
      )
      .run(success.receiptId)
    const created = resumeWorkflowCompletionReconciliations({
      store,
      orchestration: orchSucceeded(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord
    })
    expect(created).toEqual([])
    expect(getWorkflowCompletion(store.persistenceDb, success.receiptId)?.state).toBe(
      'workflow-settled'
    )
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: { ...run, status: 'paused' } as WorkflowRunRecord
    })
    expect(getWorkflowCompletion(store.persistenceDb, success.receiptId)?.state).toBe('settled')
  })
})
