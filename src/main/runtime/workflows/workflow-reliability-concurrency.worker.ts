/**
 * Worker entry for dual-connection concurrency tests.
 * Bundled via esbuild from the test file so two OS threads can race SQLite.
 *
 * Consume workers open an already-initialized DB via WorkflowRuntimePersistence
 * (no schema seed) so only the target CAS races after the barrier.
 */
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import Database from '../../sqlite/sync-database'
import {
  getWorkflowCompletion,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import {
  consumeWorkflowRetryOutbox,
  type WorkflowMutationHost
} from './workflow-completion-retry-outbox'
import { WorkflowRuntimePersistence } from './workflow-runtime-persistence'

export type ConcurrencyWorkerData =
  | {
      kind: 'receive'
      dbPath: string
      sab: SharedArrayBuffer
      role: string
      digest: string
      outcome: 'succeeded' | 'failed'
    }
  | {
      kind: 'consume'
      dbPath: string
      sab: SharedArrayBuffer
      role: string
      receiptId: string
      run: WorkflowRunRecord
    }
  | {
      kind: 'consume-v2'
      dbPath: string
      sab: SharedArrayBuffer
      role: string
      receiptId: string
      run: WorkflowRunRecord
    }

type WorkerResult =
  | {
      ok: true
      role: string
      kind: 'receive'
      created: boolean
      conflict: boolean
      receiptId: string
      outcome: string
    }
  | {
      ok: true
      role: string
      kind: 'consume' | 'consume-v2'
      stepId: string | null
      attempt: number | null
    }
  | {
      ok: false
      role: string
      kind: string
      code: string | null
      message: string
    }

function markReady(sab: SharedArrayBuffer): void {
  const gate = new Int32Array(sab)
  Atomics.add(gate, 0, 1)
  Atomics.notify(gate, 0)
}

function waitForGo(sab: SharedArrayBuffer): void {
  const gate = new Int32Array(sab)
  while (Atomics.load(gate, 1) === 0) {
    Atomics.wait(gate, 1, 0)
  }
}

/** Open existing Workflow DB without create/seed write traffic. */
function openMutationHost(dbPath: string): WorkflowMutationHost & { close(): void } {
  const db = new Database(dbPath, { fileMustExist: true, timeout: 10_000 })
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 10000')
  const persistence = new WorkflowRuntimePersistence(db)
  return {
    persistenceDb: db,
    transaction: <T>(operation: () => T): T => persistence.transaction(operation),
    getStep: (stepRunId) => persistence.getStep(stepRunId),
    insertStep: (...args) => persistence.insertStep(...args),
    insertEvent: (...args) => persistence.insertEvent(...args),
    close: () => db.close()
  }
}

function runReceive(data: Extract<ConcurrencyWorkerData, { kind: 'receive' }>): WorkerResult {
  const db = new Database(data.dbPath, { fileMustExist: true, timeout: 10_000 })
  try {
    db.pragma('busy_timeout = 10000')
    markReady(data.sab)
    waitForGo(data.sab)
    const result = receiveWorkflowCompletion(db, {
      runId: 'run-dual',
      stepRunId: 'step-dual',
      attempt: 1,
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      messageDigest: data.digest,
      outcome: data.outcome,
      errorCode: 'workflow_completion_incomplete',
      errorMessage: data.role
    })
    return {
      ok: true,
      role: data.role,
      kind: 'receive',
      created: result.created,
      conflict: result.conflict,
      receiptId: result.record.receiptId,
      outcome: result.record.outcome
    }
  } finally {
    db.close()
  }
}

function runConsume(data: Extract<ConcurrencyWorkerData, { kind: 'consume' }>): WorkerResult {
  const host = openMutationHost(data.dbPath)
  try {
    const record = getWorkflowCompletion(host.persistenceDb, data.receiptId)
    if (!record) {
      markReady(data.sab)
      return {
        ok: false,
        role: data.role,
        kind: 'consume',
        code: null,
        message: `missing receipt ${data.receiptId}`
      }
    }
    markReady(data.sab)
    waitForGo(data.sab)
    const step = consumeWorkflowRetryOutbox(host, data.run, record)
    return {
      ok: true,
      role: data.role,
      kind: 'consume',
      stepId: step?.id ?? null,
      attempt: step?.attempt ?? null
    }
  } finally {
    host.close()
  }
}

function runConsumeV2(data: Extract<ConcurrencyWorkerData, { kind: 'consume-v2' }>): WorkerResult {
  const host = openMutationHost(data.dbPath)
  try {
    const record = getWorkflowCompletion(host.persistenceDb, data.receiptId)
    const step = record ? host.getStep(record.stepRunId) : null
    if (!record || !step) {
      markReady(data.sab)
      return {
        ok: false,
        role: data.role,
        kind: 'consume-v2',
        code: null,
        message: `missing V2 receipt or step ${data.receiptId}`
      }
    }
    markReady(data.sab)
    waitForGo(data.sab)
    const retry = consumeWorkflowRetryOutbox(host, data.run, record)
    return {
      ok: true,
      role: data.role,
      kind: 'consume-v2',
      stepId: retry?.id ?? null,
      attempt: retry?.attempt ?? null
    }
  } finally {
    host.close()
  }
}

function run(): WorkerResult {
  const data = workerData as ConcurrencyWorkerData
  if (data.kind === 'receive') {
    return runReceive(data)
  }
  return data.kind === 'consume-v2' ? runConsumeV2(data) : runConsume(data)
}

try {
  parentPort?.postMessage(run())
} catch (error) {
  const data = workerData as ConcurrencyWorkerData
  try {
    markReady(data.sab)
  } catch {
    // ignore barrier failures while reporting the original error
  }
  const err = error as { code?: string; message?: string }
  parentPort?.postMessage({
    ok: false,
    role: data.role,
    kind: data.kind,
    code: err.code ?? null,
    message: err.message ?? String(error)
  } satisfies WorkerResult)
}
