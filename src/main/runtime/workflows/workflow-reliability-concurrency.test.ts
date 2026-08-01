import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import * as esbuild from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import Database from '../../sqlite/sync-database'
import { getWorkflowCompletion } from './workflow-completion-reconciliation-store'
import { reconcileWorkflowStepFailure } from './workflow-completion-failure-reconciler'
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { WorkflowError } from './workflow-error'
import { WorkflowStore } from './workflow-store'
import { createWorkflowReliabilityTables } from './workflow-database-reliability-schema'
import type { ConcurrencyWorkerData } from './workflow-reliability-concurrency.worker'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []
const bundleDir = join(tmpdir(), `orca-workflow-conc-bundle-${randomUUID()}`)
let workerBundlePath = ''

beforeAll(async () => {
  mkdirSync(bundleDir, { recursive: true })
  workerBundlePath = join(bundleDir, 'workflow-reliability-concurrency.worker.mjs')
  const entry = fileURLToPath(
    new URL('./workflow-reliability-concurrency.worker.ts', import.meta.url)
  )
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: workerBundlePath,
    packages: 'bundle'
  })
})

afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true })
})

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

function decideNode() {
  return {
    id: 'code-decide',
    name: 'Decide',
    type: 'decide' as const,
    roleSlotIds: ['primary'],
    promptTemplateKey: 'builtin.spec.decide.v1' as const,
    retryPolicy: { maxAttempts: 2, backoffMs: 0, onExhausted: 'wait-human' as const },
    promptRules: {
      rules: [{ id: 'first', name: 'first', when: 'first-visit' as const, template: 'decide' }],
      completionCriteria: 'done'
    },
    inputBindings: [],
    mode: 'rules' as const,
    outputSchema: 'workflow.decision/v1' as const
  }
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

function seedRun(
  store: WorkflowStore,
  options: { runId: string; node: ReturnType<typeof decideNode> | ReturnType<typeof produceNode> }
): { run: WorkflowRunRecord; step: WorkflowStepRunRecord } {
  const run = {
    id: options.runId,
    status: 'running',
    templateSnapshot: { nodes: [options.node], transitions: [] },
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
    options.node,
    {
      nodeId: options.node.id,
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
    1
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
  return { run: { ...run, steps: [refreshed] }, step: refreshed }
}

/** Construct settled+pending outbox without ever creating attempt=2 or step-retried. */
function seedPendingRetryOutbox(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): string {
  store.persistenceDb
    .prepare(
      `UPDATE workflow_step_runs
       SET status = 'completion-incomplete',
           error_code = 'workflow_decision_invalid',
           error_message = 'invalid decision',
           completed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(step.id)
  const receiptId = `workflow_completion_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  store.persistenceDb
    .prepare(
      `INSERT INTO workflow_completion_reconciliations (
         receipt_id, run_id, step_run_id, attempt, task_id, dispatch_id,
         message_digest, outcome, state, retry_outbox_state, retry_step_run_id,
         retry_blocked, error_code, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', 'settled', 'pending', NULL, 0, ?, ?)`
    )
    .run(
      receiptId,
      run.id,
      step.id,
      step.attempt,
      step.taskId,
      step.dispatchId,
      `digest-${receiptId}`,
      'workflow_decision_invalid',
      'invalid decision'
    )
  return receiptId
}

type WorkerRaceResult = {
  ok: boolean
  role: string
  kind: string
  created?: boolean
  conflict?: boolean
  receiptId?: string
  outcome?: string
  stepId?: string | null
  attempt?: number | null
  code?: string | null
  message?: string
}

async function raceWorkers(payloads: ConcurrencyWorkerData[]): Promise<WorkerRaceResult[]> {
  const sab = payloads[0]!.sab
  const gate = new Int32Array(sab)
  const jobs = payloads.map(
    (data) =>
      new Promise<WorkerRaceResult>((resolve, reject) => {
        const worker = new Worker(workerBundlePath, {
          workerData: data,
          execArgv: []
        })
        worker.on('message', (message: WorkerRaceResult) => {
          resolve(message)
          void worker.terminate()
        })
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0 && code !== 1) {
            reject(new Error(`worker ${data.role} exited ${code}`))
          }
        })
      })
  )
  const started = Date.now()
  while (Atomics.load(gate, 0) < payloads.length) {
    Atomics.wait(gate, 0, Atomics.load(gate, 0), 50)
    if (Date.now() - started > 15_000) {
      throw new Error(`barrier ready timeout: ${Atomics.load(gate, 0)}/${payloads.length}`)
    }
  }
  Atomics.store(gate, 1, 1)
  Atomics.notify(gate, 1, payloads.length)
  return Promise.all(jobs)
}

describe('workflow reliability schema migration', () => {
  it('adds retry_blocked to legacy completion reconciliation tables', () => {
    const path = join(tmpdir(), `orca-workflow-mig-${randomUUID()}.db`)
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
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, step_run_id, attempt)
      );
      INSERT INTO workflow_completion_reconciliations (
        receipt_id, run_id, step_run_id, attempt, message_digest, outcome, state
      ) VALUES ('r1', 'run-1', 'step-1', 1, 'digest', 'failed', 'received');
    `)
    createWorkflowReliabilityTables(db)
    const columns = db.prepare(`PRAGMA table_info(workflow_completion_reconciliations)`).all() as {
      name: string
    }[]
    expect(columns.some((column) => column.name === 'retry_blocked')).toBe(true)
    const row = db
      .prepare(
        `SELECT retry_blocked FROM workflow_completion_reconciliations WHERE receipt_id = 'r1'`
      )
      .get() as { retry_blocked: number }
    expect(row.retry_blocked).toBe(0)
    db.close()
  })
})

describe('dual-connection competition', () => {
  it('races two worker-thread connections for the same attempt receipt', async () => {
    const path = join(tmpdir(), `orca-workflow-dual-receipt-${randomUUID()}.db`)
    databasePaths.push(path)
    const bootstrap = new WorkflowStore(path)
    openStores.push(bootstrap)
    bootstrap.close()
    openStores.pop()

    const sab = new SharedArrayBuffer(8)
    const results = await raceWorkers([
      {
        kind: 'receive',
        dbPath: path,
        sab,
        role: 'left',
        digest: 'digest-a',
        outcome: 'failed'
      },
      {
        kind: 'receive',
        dbPath: path,
        sab,
        role: 'right',
        digest: 'digest-b',
        outcome: 'succeeded'
      }
    ])

    for (const result of results) {
      expect(result.ok, result.message ?? JSON.stringify(result)).toBe(true)
      expect(result.code).toBeFalsy()
      expect(result.message ?? '').not.toMatch(/SQLITE_BUSY|database is locked/i)
    }
    const created = results.filter((result) => result.created)
    expect(created).toHaveLength(1)
    expect(new Set(results.map((result) => result.receiptId)).size).toBe(1)
    expect(results.some((result) => result.conflict)).toBe(true)

    const inspect = new Database(path)
    inspect.pragma('busy_timeout = 5000')
    const count = inspect
      .prepare(
        `SELECT COUNT(*) AS n FROM workflow_completion_reconciliations
         WHERE run_id = ? AND step_run_id = ? AND attempt = 1`
      )
      .get('run-dual', 'step-dual') as { n: number }
    expect(count.n).toBe(1)
    inspect.close()
  })

  it('races two worker-thread outbox consumers for a single attempt=2 winner', async () => {
    const path = join(tmpdir(), `orca-workflow-dual-outbox-${randomUUID()}.db`)
    databasePaths.push(path)
    const writer = new WorkflowStore(path)
    openStores.push(writer)
    const { run, step } = seedRun(writer, { runId: 'run-outbox', node: decideNode() })
    const receiptId = seedPendingRetryOutbox(writer, run, step)
    // Precondition: legal crash point — settled+pending, no attempt=2, no step-retried.
    expect(
      writer.persistenceDb
        .prepare(`SELECT COUNT(*) AS n FROM workflow_step_runs WHERE run_id = ? AND attempt = 2`)
        .get(run.id) as { n: number }
    ).toEqual({ n: 0 })
    expect(
      writer.persistenceDb
        .prepare(
          `SELECT COUNT(*) AS n FROM workflow_events WHERE run_id = ? AND type = 'step-retried'`
        )
        .get(run.id) as { n: number }
    ).toEqual({ n: 0 })
    writer.close()
    openStores.pop()

    const runPayload = {
      ...run,
      steps: []
    } as WorkflowRunRecord

    const sab = new SharedArrayBuffer(8)
    const results = await raceWorkers([
      {
        kind: 'consume',
        dbPath: path,
        sab,
        role: 'A',
        receiptId,
        run: runPayload
      },
      {
        kind: 'consume',
        dbPath: path,
        sab,
        role: 'B',
        receiptId,
        run: runPayload
      }
    ])

    for (const result of results) {
      expect(result.ok, result.message ?? JSON.stringify(result)).toBe(true)
      expect(result.code).toBeFalsy()
      expect(result.message ?? '').not.toMatch(/SQLITE_BUSY|database is locked/i)
    }
    const stepIds = results.map((result) => result.stepId).filter(Boolean)
    expect(stepIds).toHaveLength(2)
    expect(new Set(stepIds).size).toBe(1)

    const inspect = new WorkflowStore(path)
    openStores.push(inspect)
    const attempts = inspect.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND attempt = 2`)
      .all(run.id) as { id: string }[]
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.id).toBe(stepIds[0])
    const receipt = getWorkflowCompletion(inspect.persistenceDb, receiptId)!
    expect(receipt.retryOutboxState).toBe('consumed')
    expect(receipt.retryStepRunId).toBe(attempts[0]!.id)
    const retriedEvents = inspect.persistenceDb
      .prepare(`SELECT id FROM workflow_events WHERE run_id = ? AND type = 'step-retried'`)
      .all(run.id) as { id: string }[]
    expect(retriedEvents).toHaveLength(1)
  })

  it('fail-closes when fail settlement loses to concurrent success on re-query', () => {
    const path = join(tmpdir(), `orca-workflow-dual-race-${randomUUID()}.db`)
    databasePaths.push(path)
    const store = new WorkflowStore(path)
    openStores.push(store)
    const { run, step } = seedRun(store, { runId: 'run-race', node: produceNode() })

    // Staged race: first reads see dispatched/ready; settleWorkerReport loses;
    // post-settle re-query sees completed/succeeded (successTerminal branch).
    let afterSettleAttempt = false
    const settleWorkerReport = vi.fn(() => {
      afterSettleAttempt = true
      return null
    })
    const orchestration = {
      getWorkerDispatch: vi.fn(() =>
        afterSettleAttempt ? { state: 'succeeded' } : { state: 'ready' }
      ),
      getTask: vi.fn(() =>
        afterSettleAttempt ? { status: 'completed' } : { status: 'dispatched' }
      ),
      getDispatchContextById: vi.fn(() =>
        afterSettleAttempt ? { status: 'completed' } : { status: 'dispatched' }
      ),
      failWorkerStart: vi.fn(),
      settleWorkerReport
    } as unknown as OrchestrationDb

    const result = reconcileWorkflowStepFailure({
      store,
      orchestration,
      run,
      step,
      error: new WorkflowError('workflow_completion_incomplete', 'timeout racing success')
    })

    expect(settleWorkerReport).toHaveBeenCalledOnce()
    expect(result.retryStep).toBeNull()
    const receipt = getWorkflowCompletion(store.persistenceDb, result.receiptId)!
    expect(receipt.retryBlocked).toBe(true)
    expect(receipt.retryOutboxState).toBe('none')
    const attempts = store.persistenceDb
      .prepare(`SELECT COUNT(*) AS n FROM workflow_step_runs WHERE run_id = ?`)
      .get(run.id) as { n: number }
    expect(attempts.n).toBe(1)
  })
})
