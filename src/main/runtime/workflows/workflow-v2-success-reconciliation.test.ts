import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowAgentAssignment } from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  advanceWorkflowCompletionState,
  getWorkflowCompletion,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import { applyWorkflowSuccessWriteAtomic } from './workflow-completion-success-apply'
import { buildSuccessPayloadFromPrepared } from './workflow-completion-success-payload'
import { resumeWorkflowSuccessCompletions } from './workflow-completion-success-reconciler'
import { claimWorkflowDispatchOwnership } from './workflow-dispatch-ownership-store'
import { listWorkflowV2History } from './workflow-v2-history-store'
import { WorkflowStore } from './workflow-store'

const stores: WorkflowStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
})

describe('Workflow V2 success reconciliation recovery', () => {
  for (const crashState of ['received', 'orchestration-settled', 'workflow-settled'] as const) {
    it(`resumes ${crashState} without duplicate history or downstream work`, async () => {
      const seeded = seedV2Attempt()
      const payload = buildSuccessPayloadFromPrepared('produce', seeded.prepared)!
      const received = receiveWorkflowCompletion(seeded.store.persistenceDb, {
        runId: seeded.run.id,
        stepRunId: seeded.step.id,
        attempt: seeded.step.attempt,
        taskId: seeded.step.taskId,
        dispatchId: seeded.step.dispatchId,
        messageDigest: seeded.prepared.digest,
        outcome: 'succeeded',
        successPayload: payload
      }).record
      if (crashState !== 'received') {
        advanceWorkflowCompletionState(
          seeded.store.persistenceDb,
          received.receiptId,
          'received',
          'orchestration-settled'
        )
      }
      if (crashState === 'workflow-settled') {
        const current = getWorkflowCompletion(seeded.store.persistenceDb, received.receiptId)!
        applyWorkflowSuccessWriteAtomic(seeded.store, seeded.run, seeded.step, current)
      }

      await resumeWorkflowSuccessCompletions({
        store: seeded.store,
        orchestration: succeededOrchestration(),
        runtime: runtimeStub(),
        run: seeded.store.showRun(seeded.run.id, 'user-a')
      })
      await resumeWorkflowSuccessCompletions({
        store: seeded.store,
        orchestration: succeededOrchestration(),
        runtime: runtimeStub(),
        run: seeded.store.showRun(seeded.run.id, 'user-a')
      })

      expect(seeded.store.showRun(seeded.run.id, 'user-a').status).toBe('completed')
      expect(getWorkflowCompletion(seeded.store.persistenceDb, received.receiptId)?.state).toBe(
        'settled'
      )
      expect(listWorkflowV2History(seeded.store.persistenceDb, seeded.run.id)).toHaveLength(1)
    })
  }

  it('keeps a single outcome when V2 success and failure receipts compete', () => {
    const seeded = seedV2Attempt()
    const payload = buildSuccessPayloadFromPrepared('produce', seeded.prepared)!
    const success = receiveWorkflowCompletion(seeded.store.persistenceDb, {
      runId: seeded.run.id,
      stepRunId: seeded.step.id,
      attempt: seeded.step.attempt,
      taskId: seeded.step.taskId,
      dispatchId: seeded.step.dispatchId,
      messageDigest: 'success-digest',
      outcome: 'succeeded',
      successPayload: payload
    })
    const failure = receiveWorkflowCompletion(seeded.store.persistenceDb, {
      runId: seeded.run.id,
      stepRunId: seeded.step.id,
      attempt: seeded.step.attempt,
      taskId: seeded.step.taskId,
      dispatchId: seeded.step.dispatchId,
      messageDigest: 'failure-digest',
      outcome: 'failed',
      errorCode: 'workflow_completion_incomplete'
    })
    expect(success.created).toBe(true)
    expect(failure.conflict).toBe(true)
    expect(failure.record.receiptId).toBe(success.record.receiptId)
    expect(failure.record.outcome).toBe('succeeded')
  })
})

function seedV2Attempt() {
  const store = new WorkflowStore(':memory:')
  stores.push(store)
  const created = store.createRun(
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
      runId: created.id,
      nodeId: 'produce',
      slotId: 'worker',
      assignment: assignment()
    },
    mutation('assign')
  )
  store.updateRunObjective(
    { runId: created.id, objective: 'Verify V2 recovery.' },
    mutation('objective')
  )
  store.prepareRun(
    {
      runId: created.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('prepare')
  )
  let run = store.beginRun({ runId: created.id, baseline: {} }, mutation('start'))
  store.setOrchestrationRun(run.id, 'orch-run-v2')
  const initial = run.steps.find((candidate) => candidate.nodeId === 'produce')!
  store.markStepDelivering({
    runId: run.id,
    stepRunId: initial.id,
    taskId: 'task-v2',
    dispatchId: 'dispatch-v2',
    prompt: 'prompt'
  })
  run = store.showRun(run.id, 'user-a')
  const step = run.steps.find((candidate) => candidate.id === initial.id)!
  claimWorkflowDispatchOwnership(store.persistenceDb, {
    runId: run.id,
    nodeId: step.nodeId,
    round: step.round,
    assignmentKey: `${step.assignment!.slotId}:${step.assignment!.agentLifecycleId}`,
    stepRunId: step.id,
    attempt: step.attempt,
    taskId: step.taskId,
    dispatchId: step.dispatchId
  })
  const prepared = {
    value: {
      schema: 'workflow.completion/v1' as const,
      taskId: 'task-v2',
      dispatchId: 'dispatch-v2',
      workflowRunId: run.id,
      stepRunId: step.id,
      agentLifecycleId: 'worker',
      providerSessionId: 'session-worker',
      executionHostId: 'local',
      outcome: 'succeeded' as const,
      summary: 'done',
      finalConclusionMarkdown: 'V2 output complete.',
      artifacts: [],
      validations: [],
      unresolved: [],
      readyForNextStep: true
    },
    source: 'report-path' as const,
    digest: 'v2-success-digest',
    sourceIdentity: 'agent-v2',
    sourceReference: { reportPath: '/tmp/v2.json', preparedAt: '2026-08-03T00:00:00Z' },
    warnings: [] as string[],
    filesModified: [] as string[],
    reportPath: '/tmp/v2.json'
  }
  return { store, run, step, prepared }
}

function assignment(): Omit<WorkflowAgentAssignment, 'nodeId' | 'slotId'> {
  return {
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey: 'pane-worker',
    agentLifecycleId: 'worker',
    providerSessionId: 'session-worker',
    runtimeAgent: 'codex'
  }
}

function mutation(requestId: string) {
  return { callerIdentity: 'user-a', requestId, method: `test.${requestId}`, payload: {} }
}

function succeededOrchestration(): OrchestrationDb {
  return {
    getWorkerDispatch: vi.fn(() => ({ state: 'succeeded' })),
    getTask: vi.fn(() => ({ status: 'completed' })),
    getDispatchContextById: vi.fn(() => ({ status: 'completed' })),
    getRunMailboxHistory: vi.fn(() => []),
    getMessageById: vi.fn(() => undefined)
  } as unknown as OrchestrationDb
}

function runtimeStub(): OrcaRuntimeService {
  return {
    resolveTerminalPane: vi.fn(() => ({ handle: 'terminal-worker' })),
    notifyMessageArrived: vi.fn()
  } as unknown as OrcaRuntimeService
}
