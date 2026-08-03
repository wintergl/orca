import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertWorkflowAgentLifecycle } from '../../workflows/workflow-agent-lifecycle-authority'
import { WorkflowStore } from '../../workflows/workflow-store'
import type { RpcContext, RpcMethod } from '../core'
import { WORKFLOW_METHODS } from './workflows'

type RuntimeFake = {
  getWorkflowStore: () => WorkflowStore
  resolveTerminalPane: ReturnType<typeof vi.fn>
  getTerminalAgentStatus: ReturnType<typeof vi.fn>
  getTerminalWorktreeIdForPaneKey: ReturnType<typeof vi.fn>
  showManagedWorktree: ReturnType<typeof vi.fn>
  sendTerminalAgentPrompt: ReturnType<typeof vi.fn>
  getTerminalProcessIncarnation: ReturnType<typeof vi.fn>
  getExactWorkerProviderSession: ReturnType<typeof vi.fn>
  getAgentLifecycleAuthorityIdForPaneKey?: ReturnType<typeof vi.fn>
}

let store: WorkflowStore
let runtime: RuntimeFake

function method(name: string): RpcMethod {
  const found = WORKFLOW_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

async function call(name: string, params: unknown): Promise<unknown> {
  const rpcMethod = method(name)
  const parsed = rpcMethod.params?.parse(params)
  return rpcMethod.handler(parsed, {
    runtime: runtime as unknown as RpcContext['runtime'],
    authenticatedCallerFingerprint: 'user-a'
  })
}

function assignment(
  lifecycle: string,
  paneKey: string
): {
  worktreeId: string
  executionHostId: string
  paneKey: string
  agentLifecycleId: string
  providerSessionId: null
  runtimeAgent: string
} {
  return {
    worktreeId: 'worktree-a',
    executionHostId: 'local',
    paneKey,
    agentLifecycleId: lifecycle,
    providerSessionId: null,
    runtimeAgent: 'codex'
  }
}

beforeEach(() => {
  store = new WorkflowStore(':memory:')
  runtime = {
    getWorkflowStore: () => store,
    resolveTerminalPane: vi.fn(({ length }: string) => ({ handle: `handle-${length}` })),
    getTerminalAgentStatus: vi.fn(async (handle: string) => ({
      handle,
      isRunningAgent: true,
      status: 'idle'
    })),
    getTerminalWorktreeIdForPaneKey: vi.fn(() => 'worktree-a'),
    showManagedWorktree: vi.fn(async () => ({ id: 'worktree-a' })),
    sendTerminalAgentPrompt: vi.fn(),
    getTerminalProcessIncarnation: vi.fn((handle: string) => `process-${handle}`),
    getExactWorkerProviderSession: vi.fn(() => null),
    getAgentLifecycleAuthorityIdForPaneKey: vi.fn((paneKey: string) => `authority-${paneKey}`)
  }
})

afterEach(() => {
  store.close()
})

describe('workflow template RPC', () => {
  it('lists built-ins and returns a distinct invalid-definition error', async () => {
    const listed = (await call('workflow.templateList', {
      projectIdentity: 'project-a'
    })) as unknown[]
    expect(listed).toHaveLength(6)
    await expect(
      call('workflow.templateCreate', {
        requestId: 'bad-definition',
        name: 'Bad flow',
        scope: 'personal',
        definition: { schemaVersion: 2 }
      })
    ).rejects.toMatchObject({ code: 'workflow_definition_invalid' })
  })

  it('clones built-ins before editing and archives without physical deletion', async () => {
    const clone = (await call('workflow.templateClone', {
      requestId: 'clone',
      sourceTemplateId: 'builtin.spec-review.v1',
      name: 'My SPEC flow',
      scope: 'personal'
    })) as { id: string; currentVersion: number }
    const updated = (await call('workflow.templateUpdate', {
      requestId: 'update',
      templateId: clone.id,
      expectedVersion: clone.currentVersion,
      name: 'My SPEC flow v2',
      definition: store.showTemplate({
        templateId: clone.id,
        callerIdentity: 'user-a'
      }).definition
    })) as { currentVersion: number }
    expect(updated.currentVersion).toBe(2)
    const archived = (await call('workflow.templateArchive', {
      requestId: 'archive',
      templateId: clone.id
    })) as { archivedAt: string | null }
    expect(archived.archivedAt).not.toBeNull()
    await expect(call('workflow.templateShow', { templateId: clone.id })).resolves.toMatchObject({
      id: clone.id
    })
  })
})

describe('workflow run RPC', () => {
  it('registers every M4 control RPC and rejects a forged Resolution Offer', async () => {
    expect(WORKFLOW_METHODS.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining([
        'workflow.runPause',
        'workflow.runResume',
        'workflow.runCancel',
        'workflow.runResolve',
        'workflow.stepRetry',
        'workflow.stepReassign'
      ])
    )
    const run = (await call('workflow.runCreate', {
      requestId: 'create-resolution-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }

    await expect(
      call('workflow.runResolve', {
        requestId: 'forged-offer',
        runId: run.id,
        offerId: 'workflow_offer_forged',
        confirmation: true
      })
    ).rejects.toMatchObject({ code: 'workflow_offer_conflict' })
  })

  it('checks workspace existence independently from Agent assignments', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-unassigned-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    const result = (await call('workflow.runPrepare', {
      requestId: 'prepare-unassigned',
      runId: run.id
    })) as { checks: { id: string; status: string }[] }
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'workspace-context', status: 'passed' })
    )
  })

  it('rejects an Agent that is no longer idle before saving the assignment', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    runtime.getTerminalAgentStatus.mockResolvedValue({
      handle: 'handle',
      isRunningAgent: true,
      status: 'working'
    })
    await expect(
      call('workflow.runAssign', {
        requestId: 'assign-working',
        runId: run.id,
        nodeId: 'spec-produce',
        slotId: 'spec-author',
        assignment: assignment('author', 'pane-author')
      })
    ).rejects.toMatchObject({
      code: 'workflow_agent_unavailable',
      message: 'Agent is working. Choose a current idle Agent.'
    })
    expect(store.showRun(run.id, 'user-a').assignments).toEqual([])
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('names an assigned Agent that stops being idle before preflight', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-stale-idle-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    await call('workflow.runAssign', {
      requestId: 'assign-idle-author',
      runId: run.id,
      nodeId: 'spec-produce',
      slotId: 'spec-author',
      assignment: assignment('author', 'pane-author')
    })
    runtime.getTerminalAgentStatus.mockResolvedValue({
      handle: 'handle',
      isRunningAgent: true,
      status: 'working'
    })

    const preflight = (await call('workflow.runPrepare', {
      requestId: 'prepare-stale-idle',
      runId: run.id
    })) as { checks: { id: string; status: string; message: string; recovery: string }[] }
    const availability = preflight.checks.find((check) => check.id === 'agent-availability')

    expect(availability).toMatchObject({
      status: 'failed',
      recovery: 'Wait until the listed Agent is idle, or reassign it'
    })
    expect(availability?.message).toContain('SPEC 编写 / SPEC 编写 Agent (codex): Agent is working')
  })

  it('switches a Draft template in place and clears prior assignments', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-switch-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string; version: number }
    const assigned = (await call('workflow.runAssign', {
      requestId: 'assign-before-switch',
      runId: run.id,
      nodeId: 'spec-produce',
      slotId: 'spec-author',
      assignment: assignment('author', 'pane-author')
    })) as { version: number }

    await expect(
      call('workflow.runSwitchTemplate', {
        requestId: 'switch-run-template',
        runId: run.id,
        templateId: 'builtin.code-review.v1',
        expectedVersion: assigned.version
      })
    ).resolves.toMatchObject({
      id: run.id,
      status: 'draft',
      templateId: 'builtin.code-review.v1',
      assignments: []
    })
  })

  it('does not release a newer lifecycle claim when a template-switch receipt is replayed', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-replayed-switch-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    const assigned = (await call('workflow.runAssign', {
      requestId: 'assign-before-replayed-switch',
      runId: run.id,
      nodeId: 'spec-produce',
      slotId: 'spec-author',
      assignment: assignment('author', 'pane-author')
    })) as { version: number }
    const switchParams = {
      requestId: 'replayed-switch',
      runId: run.id,
      templateId: 'builtin.code-review.v1',
      expectedVersion: assigned.version
    }
    await call('workflow.runSwitchTemplate', switchParams)
    await call('workflow.runAssign', {
      requestId: 'assign-after-replayed-switch',
      runId: run.id,
      nodeId: 'code-produce',
      slotId: 'implementer',
      assignment: assignment('implementer', 'pane-author')
    })
    await call('workflow.runPrepare', {
      requestId: 'prepare-after-replayed-switch',
      runId: run.id
    })

    await call('workflow.runSwitchTemplate', switchParams)

    const persisted = store.showRun(run.id, 'user-a')
    expect(persisted.assignments).toHaveLength(1)
    expect(() =>
      assertWorkflowAgentLifecycle(
        runtime as unknown as Parameters<typeof assertWorkflowAgentLifecycle>[0],
        persisted.assignments[0],
        'handle-11'
      )
    ).not.toThrow()
  })

  it('replaces renderer lifecycle identity with main-process authority', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-authority-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    runtime.getAgentLifecycleAuthorityIdForPaneKey = vi.fn(() => 'observed-lifecycle')

    const updated = (await call('workflow.runAssign', {
      requestId: 'assign-canonical-lifecycle',
      runId: run.id,
      nodeId: 'spec-produce',
      slotId: 'spec-author',
      assignment: assignment('renderer-lifecycle', 'pane-author')
    })) as { assignments: { agentLifecycleId: string }[] }

    expect(updated.assignments).toContainEqual(
      expect.objectContaining({ agentLifecycleId: 'observed-lifecycle' })
    )
  })

  it('marks a fully assigned Draft ready without dispatching', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-ready-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    for (const [nodeId, slotId, lifecycle, paneKey] of [
      ['spec-produce', 'spec-author', 'author', 'pane-author'],
      ['spec-review', 'spec-reviewers', 'reviewer', 'pane-reviewer']
    ]) {
      await call('workflow.runAssign', {
        requestId: `assign-${lifecycle}`,
        runId: run.id,
        nodeId,
        slotId,
        assignment: assignment(lifecycle, paneKey)
      })
    }
    await call('workflow.runUpdate', {
      requestId: 'objective',
      runId: run.id,
      objective: 'Complete M1 without dispatching any prompt.'
    })
    const result = (await call('workflow.runPrepare', {
      requestId: 'prepare',
      runId: run.id
    })) as { ready: boolean; run: { status: string } }
    expect(result).toMatchObject({ ready: true, run: { status: 'ready' } })
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('rejects a stale lifecycle claim on the same Pane', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-lifecycle-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'local'
    })) as { id: string }
    await call('workflow.runAssign', {
      requestId: 'assign-original',
      runId: run.id,
      nodeId: 'spec-produce',
      slotId: 'spec-author',
      assignment: assignment('original-lifecycle', 'pane-author')
    })
    await expect(
      call('workflow.runAssign', {
        requestId: 'assign-replacement',
        runId: run.id,
        nodeId: 'spec-review',
        slotId: 'spec-reviewers',
        assignment: assignment('replacement-lifecycle', 'pane-author')
      })
    ).rejects.toMatchObject({ code: 'workflow_context_mismatch' })
  })

  it('fails Host capability preflight for SSH execution', async () => {
    const run = (await call('workflow.runCreate', {
      requestId: 'create-ssh-run',
      templateId: 'builtin.spec-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'git-worktree', id: 'worktree-a' },
      executionHostId: 'ssh:build'
    })) as { id: string }

    const result = (await call('workflow.runPrepare', {
      requestId: 'prepare-ssh',
      runId: run.id
    })) as { checks: { id: string; status: string }[] }

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'workspace-capability', status: 'failed' })
    )
  })
})
