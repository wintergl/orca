import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WorkflowEngine } from './workflow-engine'
import {
  cleanupWorkflowEngineHarnesses,
  lifecycleIdForHandle,
  paneKeyForHandle,
  registerWorkflowEngine,
  registerWorkflowEngineCleanupPath,
  registerWorkflowEngineOrchestration,
  registerWorkflowEngineStore
} from './workflow-engine-test-harness-support'
import { queueV2Completion, readyV2Run } from './workflow-engine-test-v2-fixtures'
import { waitForRun } from './workflow-engine-test-waits'
import { listWorkflowV2History } from './workflow-v2-history-store'
import { WorkflowStore } from './workflow-store'

const V2_HANDLES: Record<string, string> = {
  'pane-worker': 'terminal-worker',
  'pane-producer': 'terminal-producer',
  'pane-judge': 'terminal-judge',
  'pane-researcher': 'terminal-researcher',
  'pane-writer': 'terminal-writer'
}

afterEach(async () => {
  await cleanupWorkflowEngineHarnesses()
})

describe('WorkflowEngine V2', () => {
  it('completes the default SPEC writing and review flow through engine dispatch', async () => {
    const harness = await createV2Harness({
      responses: {
        'terminal-spec-author': 'SPEC 第一版',
        'terminal-spec-reviewer': '评审通过，无阻塞项。',
        'terminal-spec-decider': '完成\n符合目标'
      }
    })
    const runId = readyV2Run(harness.store, harness.runtime, 'builtin.v2.spec-review', [
      ['spec-produce', 'spec-author', 'spec-author', 'pane-spec-author', 'terminal-spec-author'],
      [
        'spec-review',
        'spec-reviewers',
        'spec-reviewer',
        'pane-spec-reviewer',
        'terminal-spec-reviewer'
      ],
      ['spec-decide', 'spec-decider', 'spec-decider', 'pane-spec-decider', 'terminal-spec-decider']
    ])
    await harness.engine.start(runId, 'user-a', {
      callerIdentity: 'user-a',
      requestId: 'v2-single-start',
      method: 'workflow.runStart',
      payload: { runId }
    })
    const completed = await waitForRun(harness.store, runId, 'completed')
    expect(completed.steps.map((step) => [step.nodeId, step.status])).toEqual([
      ['spec-produce', 'succeeded'],
      ['spec-review', 'succeeded'],
      ['spec-decide', 'succeeded']
    ])
    expect(listWorkflowV2History(harness.store.persistenceDb, runId)).toHaveLength(3)
    expect(harness.sendPrompt).toHaveBeenCalled()
    expect(String(harness.sendPrompt.mock.calls[0]?.[1] ?? '')).toContain('Run the free-form')
  })

  it('returns code to writing after review, then completes on 完成', async () => {
    const harness = await createV2Harness({
      responses: {
        'terminal-code-author': ['code v1', 'code v2'],
        'terminal-code-reviewer': ['发现阻塞项', '阻塞项已关闭'],
        'terminal-code-decider': ['不完成\n再改', '完成\n通过']
      }
    })
    const runId = readyV2Run(harness.store, harness.runtime, 'builtin.v2.code-review', [
      ['code-produce', 'code-author', 'code-author', 'pane-code-author', 'terminal-code-author'],
      [
        'code-review',
        'code-reviewers',
        'code-reviewer',
        'pane-code-reviewer',
        'terminal-code-reviewer'
      ],
      ['code-decide', 'code-decider', 'code-decider', 'pane-code-decider', 'terminal-code-decider']
    ])
    await harness.engine.start(runId, 'user-a', {
      callerIdentity: 'user-a',
      requestId: 'v2-loop-start',
      method: 'workflow.runStart',
      payload: { runId }
    })
    const completed = await waitForRun(harness.store, runId, 'completed')
    expect(completed.steps.filter((step) => step.nodeId === 'code-produce')).toHaveLength(2)
    expect(completed.steps.filter((step) => step.nodeId === 'code-review')).toHaveLength(2)
    expect(completed.steps.filter((step) => step.nodeId === 'code-decide')).toHaveLength(2)
    const history = listWorkflowV2History(harness.store.persistenceDb, runId)
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

  it('accepts a human approval when the SPEC decision is invalid', async () => {
    const harness = await createV2Harness({
      responses: {
        'terminal-spec-author': 'SPEC 第一版',
        'terminal-spec-reviewer': '需要人工确认范围。',
        'terminal-spec-decider': '请求人工确认'
      }
    })
    const runId = readyV2Run(harness.store, harness.runtime, 'builtin.v2.spec-review', [
      ['spec-produce', 'spec-author', 'spec-author', 'pane-spec-author', 'terminal-spec-author'],
      [
        'spec-review',
        'spec-reviewers',
        'spec-reviewer',
        'pane-spec-reviewer',
        'terminal-spec-reviewer'
      ],
      ['spec-decide', 'spec-decider', 'spec-decider', 'pane-spec-decider', 'terminal-spec-decider']
    ])
    await harness.engine.start(runId, 'user-a', {
      callerIdentity: 'user-a',
      requestId: 'v2-multi-start',
      method: 'workflow.runStart',
      payload: { runId }
    })
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    expect(waiting.currentNodeId).toBe('spec-human')
    const accept = waiting.resolutionOffers.find(
      (offer) => offer.resolutionTransitionId === 'v2-human:approve'
    )
    expect(accept).toBeTruthy()
    const resolved = harness.store.resolveRun(
      {
        runId,
        offerId: accept!.id,
        confirmation: true
      },
      {
        callerIdentity: 'user-a',
        requestId: 'v2-human-accept',
        method: 'workflow.runResolve',
        payload: { runId }
      }
    )
    expect(resolved.status).toBe('completed')
    expect(
      listWorkflowV2History(harness.store.persistenceDb, runId).map((e) => e.stepKind)
    ).toEqual(['agent', 'agent', 'decision', 'human'])
  })
})

async function createV2Harness(options: { responses: Record<string, string | string[]> }) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-v2-engine-'))
  registerWorkflowEngineCleanupPath(workspacePath)
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await writeFile(join(workspacePath, 'src', 'result.ts'), 'export const value = 1\n')
  const store = new WorkflowStore(':memory:')
  const orchestration = new OrchestrationDb(':memory:')
  registerWorkflowEngineStore(store)
  registerWorkflowEngineOrchestration(orchestration)
  const responseCursors: Record<string, number> = {}
  let runtime!: OrcaRuntimeService
  let engine!: WorkflowEngine
  const sendPrompt = vi.fn(async (handle: string, prompt: string) => {
    setTimeout(() => void reportStatus(handle, 'working'), 0)
    const configured = options.responses[handle]
    const text = Array.isArray(configured)
      ? (configured[responseCursors[handle] ?? 0] ?? configured.at(-1) ?? '完成')
      : (configured ?? '完成')
    if (Array.isArray(configured)) {
      responseCursors[handle] = (responseCursors[handle] ?? 0) + 1
    }
    queueV2Completion(orchestration, handle, text)
    return { handle, accepted: true, bytesWritten: prompt.length }
  })
  runtime = {
    getRuntimeId: () => 'runtime-v2-test',
    getOrchestrationDb: () => orchestration,
    resolveTerminalPane: (paneKey: string, worktreeId?: string) => ({
      handle: V2_HANDLES[paneKey] ?? `terminal-${paneKey.replace('pane-', '')}`,
      tabId: 'tab',
      leafId: paneKey,
      ptyId: `pty-${paneKey}`,
      worktreeId
    }),
    getTerminalAgentStatus: async (handle: string) => ({
      handle,
      isRunningAgent: true,
      status: 'idle'
    }),
    getTerminalProcessIncarnation: (handle: string) => `process-${handle}`,
    getExactWorkerProviderSession: (handle: string) => ({
      paneKey: paneKeyForHandle(handle),
      processIncarnation: `process-${handle}`,
      agent: 'codex',
      providerSession: {
        key: 'session_id',
        id: `session-${lifecycleIdForHandle(handle)}`
      },
      observedAt: Date.now()
    }),
    getTerminalOrchestrationCliCommand: () => 'orca',
    getTerminalPaneKey: paneKeyForHandle,
    showTerminal: async (handle: string) => ({
      handle,
      connected: true,
      writable: true,
      worktreeId: 'folder-a'
    }),
    showManagedWorktree: async () => ({
      git: { path: workspacePath }
    }),
    sendTerminalAgentPrompt: sendPrompt
  } as unknown as OrcaRuntimeService
  engine = new WorkflowEngine(runtime, store, orchestration)
  registerWorkflowEngine(engine)
  const reportStatus = async (
    handle: string,
    state: 'working' | 'done',
    lastAssistantMessage?: string
  ): Promise<boolean> => {
    const dispatch = orchestration.getLatestDispatchForTerminal(handle)
    if (!dispatch) {
      throw new Error(`Workflow Dispatch for ${handle} is unavailable.`)
    }
    return engine.handleAgentStatus({
      state,
      paneKey: paneKeyForHandle(handle),
      worktreeId: 'folder-a',
      agentLifecycleId: lifecycleIdForHandle(handle),
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      receivedAt: Date.now(),
      lastAssistantMessage
    })
  }
  return { store, orchestration, runtime, engine, sendPrompt, workspacePath }
}
