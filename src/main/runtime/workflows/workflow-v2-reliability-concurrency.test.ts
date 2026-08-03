import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import * as esbuild from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConcurrencyWorkerData } from './workflow-reliability-concurrency.worker'
import { WorkflowStore } from './workflow-store'

const testDir = join(tmpdir(), `orca-workflow-v2-concurrency-${randomUUID()}`)
const dbPath = join(testDir, 'workflow.db')
let workerBundlePath = ''

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  workerBundlePath = join(testDir, 'worker.mjs')
  await esbuild.build({
    entryPoints: [
      fileURLToPath(new URL('./workflow-reliability-concurrency.worker.ts', import.meta.url))
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: workerBundlePath,
    packages: 'bundle'
  })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('Workflow V2 dual-writer reliability', () => {
  it('creates one native attempt=2 and one retry event across two SQLite writers', async () => {
    const store = new WorkflowStore(dbPath)
    const runId = readyV2Run(store)
    store.beginRun({ runId, baseline: {} }, mutation('start'))
    const step = store
      .showRun(runId, 'user-a')
      .steps.find((candidate) => candidate.nodeId === 'produce')!
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs SET status = 'failed', error_code = 'test',
           error_message = 'test', completed_at = datetime('now') WHERE id = ?`
      )
      .run(step.id)
    const receiptId = 'receipt-v2-dual-writer'
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_completion_reconciliations (
           receipt_id, run_id, step_run_id, attempt, message_digest, outcome, state,
           retry_outbox_state
         ) VALUES (?, ?, ?, 1, 'digest', 'failed', 'settled', 'pending')`
      )
      .run(receiptId, runId, step.id)
    const run = store.showRun(runId, 'user-a')
    store.close()

    const sab = new SharedArrayBuffer(8)
    const results = await race([
      { kind: 'consume-v2', dbPath, sab, role: 'left', receiptId, run },
      { kind: 'consume-v2', dbPath, sab, role: 'right', receiptId, run }
    ])
    for (const result of results) {
      expect(result.ok, result.message).toBe(true)
      expect(result.message ?? '').not.toMatch(/SQLITE_BUSY|database is locked/i)
      expect(result.attempt).toBe(2)
    }
    expect(new Set(results.map((result) => result.stepId)).size).toBe(1)

    const inspect = new WorkflowStore(dbPath)
    expect(
      inspect.persistenceDb
        .prepare(
          `SELECT COUNT(*) AS count FROM workflow_step_runs WHERE run_id = ? AND attempt = 2`
        )
        .get(runId)
    ).toEqual({ count: 1 })
    expect(
      inspect.persistenceDb
        .prepare(
          `SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND type = 'step-retried'`
        )
        .get(runId)
    ).toEqual({ count: 1 })
    inspect.close()
  })
})

type RaceResult = {
  ok: boolean
  stepId?: string | null
  attempt?: number | null
  message?: string
}

async function race(payloads: ConcurrencyWorkerData[]): Promise<RaceResult[]> {
  const gate = new Int32Array(payloads[0]!.sab)
  const jobs = payloads.map(
    (workerData) =>
      new Promise<RaceResult>((resolve, reject) => {
        const worker = new Worker(workerBundlePath, { workerData, execArgv: [] })
        worker.on('message', resolve)
        worker.on('error', reject)
      })
  )
  const deadline = Date.now() + 15_000
  while (Atomics.load(gate, 0) < payloads.length) {
    Atomics.wait(gate, 0, Atomics.load(gate, 0), 50)
    if (Date.now() > deadline) {
      throw new Error('V2 concurrency barrier timed out')
    }
  }
  Atomics.store(gate, 1, 1)
  Atomics.notify(gate, 1, payloads.length)
  return Promise.all(jobs)
}

function readyV2Run(store: WorkflowStore): string {
  const run = store.createRun(
    {
      templateId: 'builtin.v2.single-agent-end',
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      executionHostId: 'local'
    },
    mutation('create')
  )
  store.assignAgent(
    {
      runId: run.id,
      nodeId: 'produce',
      slotId: 'worker',
      assignment: {
        worktreeId: 'folder-a',
        executionHostId: 'local',
        paneKey: 'pane-produce',
        agentLifecycleId: 'produce',
        providerSessionId: 'session-produce',
        runtimeAgent: 'codex'
      }
    },
    mutation('assign')
  )
  store.updateRunObjective({ runId: run.id, objective: 'retry' }, mutation('objective'))
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

function mutation(requestId: string) {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: `test.${requestId}`,
    payload: { requestId }
  }
}
