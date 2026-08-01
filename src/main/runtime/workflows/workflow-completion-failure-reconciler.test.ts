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
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
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
    retryPolicy: { maxAttempts, backoffMs: 0 },
    promptRules: { rules: [], completionCriteria: '' }
  }
}

function makeRunAndStep(
  store: WorkflowStore,
  options?: { maxAttempts?: number; attempt?: number }
): { run: WorkflowRunRecord; step: WorkflowStepRunRecord } {
  const node = decideNode(options?.maxAttempts ?? 2)
  const run = {
    id: 'run-recon-1',
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
      executionHostId: 'local'
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
