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
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  getWorkflowCompletion,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import { resumeWorkflowSuccessCompletions } from './workflow-completion-success-reconciler'
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { WorkflowStore } from './workflow-store'
import { recoverWorkflowRuns } from './workflow-recovery-coordinator'

const freezeMock = vi.hoisted(() =>
  vi.fn(
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
)

vi.mock('./workflow-artifact-store', () => ({
  freezeWorkflowArtifact: freezeMock
}))

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

afterEach(() => {
  freezeMock.mockClear()
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
  const path = join(tmpdir(), `orca-workflow-success-rec-${randomUUID()}.db`)
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

function seedProduceRun(store: WorkflowStore): {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
} {
  const produce = produceNode()
  const review = reviewNode()
  const templateSnapshot = {
    nodes: [produce, review],
    transitions: [
      {
        id: 'produce-to-review',
        from: produce.id,
        to: review.id,
        when: 'step:succeeded' as const
      }
    ]
  }
  const runId = `run-success-${randomUUID().slice(0, 8)}`
  store.persistenceDb
    .prepare(
      `INSERT INTO workflow_runs (
         id, status, version, template_id, template_version, template_name,
         template_snapshot_json, owner_identity, project_identity, workspace_kind,
         workspace_id, execution_host_id, objective, current_node_id
       ) VALUES (?, 'running', 1, 't1', 1, 'T', ?, 'user-a', 'project-a', 'folder-workspace',
         'ws-1', 'local', 'objective', ?)`
    )
    .run(runId, JSON.stringify(templateSnapshot), produce.id)
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
    status: 'running',
    version: 1,
    templateSnapshot,
    currentNodeId: produce.id,
    steps: [refreshed],
    reviewAggregates: [],
    decisions: [],
    assignments: [
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
    ],
    reviewRoundsByNodeId: {},
    workspace: { kind: 'folder-workspace', id: 'ws-1' },
    executionHostId: 'local',
    orchestrationRunId: 'orch-run-1'
  } as unknown as WorkflowRunRecord
  return { run, step: refreshed }
}

function preparedFor(runId: string, stepId: string) {
  return {
    value: {
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
    },
    source: 'report-path' as const,
    digest: `sha-${stepId}`,
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

function orchSucceeded(): OrchestrationDb {
  return {
    getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
    getTask: vi.fn(() => ({ status: 'completed' })),
    getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
    getRunMailboxHistory: vi.fn(() => []),
    getMessageById: vi.fn(() => undefined),
    failWorkerStart: vi.fn(),
    settleWorkerReport: vi.fn(),
    insertMessage: vi.fn()
  } as unknown as OrchestrationDb
}

function parkOrchSettledWaiting(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): string {
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
       SET state = 'orchestration-settled', resolution = 'waiting-human',
           error_code = 'workflow_delivery_uncertain',
           error_message = 'database is locked'
       WHERE receipt_id = ?`
    )
    .run(received.record.receiptId)
  store.markRecoveryWaiting(run, step, 'delivery-uncertain', 'database is locked')
  return received.record.receiptId
}

describe('success reconciliation waiting-human recovery', () => {
  it('retries waiting-human receipts and restores Run/Step for advance', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store)
    const receiptId = parkOrchSettledWaiting(store, run, step)
    await resumeWorkflowSuccessCompletions({
      store,
      orchestration: orchSucceeded(),
      runtime: runtimeStub(),
      run: {
        ...run,
        status: 'waiting-human',
        waitingReason: 'delivery-uncertain',
        failureCode: 'workflow_delivery_uncertain'
      } as WorkflowRunRecord
    })
    const settled = getWorkflowCompletion(store.persistenceDb, receiptId)!
    expect(settled.state).toBe('settled')
    expect(settled.resolution).toBe('none')
    expect(settled.errorCode).toBeNull()
    expect(settled.errorMessage).toBeNull()
    const produce = store.getStep(step.id)!
    expect(produce.status).toBe('succeeded')
    expect(produce.errorCode).toBeNull()
    const runRow = store.persistenceDb
      .prepare(
        `SELECT status, waiting_reason, failure_code, failure_message, recovery, resolution_context_json
         FROM workflow_runs WHERE id = ?`
      )
      .get(run.id) as {
      status: string
      waiting_reason: string | null
      failure_code: string | null
      failure_message: string | null
      recovery: string | null
      resolution_context_json: string | null
    }
    expect(runRow.status).toBe('running')
    expect(runRow.waiting_reason).toBeNull()
    expect(runRow.failure_code).toBeNull()
    expect(runRow.failure_message).toBeNull()
    expect(runRow.recovery).toBeNull()
    expect(runRow.resolution_context_json).toBeNull()
    expect(produce.deliveryState).toBe('delivered')
    expect(produce.recovery).toBeNull()
    const reviewSteps = store.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND node_id = 'code-review'`)
      .all(run.id) as { id: string }[]
    expect(reviewSteps).toHaveLength(1)
  })

  it('recoverWorkflowRuns restores delivery-uncertain Run and advances produce', async () => {
    const store = createStore()
    const { run, step } = seedProduceRun(store)
    const receiptId = parkOrchSettledWaiting(store, run, step)
    const showRun = vi.fn((runId: string, owner: string) => {
      expect(owner).toBe('user-a')
      expect(runId).toBe(run.id)
      const row = store.persistenceDb
        .prepare(
          `SELECT status, waiting_reason, failure_code, failure_message, recovery, version
           FROM workflow_runs WHERE id = ?`
        )
        .get(runId) as {
        status: WorkflowRunRecord['status']
        waiting_reason: WorkflowRunRecord['waitingReason']
        failure_code: string | null
        failure_message: string | null
        recovery: string | null
        version: number
      }
      return {
        ...run,
        status: row.status,
        waitingReason: row.waiting_reason,
        failureCode: row.failure_code,
        failureMessage: row.failure_message,
        recovery: row.recovery,
        version: row.version,
        steps: [store.getStep(step.id)!],
        assignments: run.assignments
      } as WorkflowRunRecord
    })
    const recoveryStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'showRun') {
          return showRun
        }
        if (prop === 'listRecoverableRunOwners') {
          return () => [{ runId: run.id, ownerIdentity: 'user-a' }]
        }
        return Reflect.get(target, prop, receiver)
      }
    }) as WorkflowStore

    await recoverWorkflowRuns({
      runtime: runtimeStub(),
      store: recoveryStore,
      orchestration: orchSucceeded(),
      recoveryOwnerId: 'runtime-test',
      resume: vi.fn()
    })

    const settled = getWorkflowCompletion(store.persistenceDb, receiptId)!
    expect(settled.state).toBe('settled')
    expect(settled.resolution).toBe('none')
    expect(settled.errorCode).toBeNull()
    expect(store.getStep(step.id)?.status).toBe('succeeded')
    expect(store.getStep(step.id)?.errorCode).toBeNull()
    const runRow = store.persistenceDb
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
    expect(runRow.status).toBe('running')
    expect(runRow.waiting_reason).toBeNull()
    expect(runRow.failure_code).toBeNull()
    expect(runRow.recovery).toBeNull()
    expect(runRow.resolution_context_json).toBeNull()
    expect(store.getStep(step.id)?.deliveryState).toBe('delivered')
    expect(store.getStep(step.id)?.recovery).toBeNull()
    const reviewSteps = store.persistenceDb
      .prepare(`SELECT id FROM workflow_step_runs WHERE run_id = ? AND node_id = 'code-review'`)
      .all(run.id) as { id: string }[]
    expect(reviewSteps).toHaveLength(1)
    expect(showRun).toHaveBeenCalled()
  })
})
