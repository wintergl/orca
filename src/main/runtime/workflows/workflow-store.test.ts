import { randomUUID } from 'node:crypto'
import { rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import type { WorkflowDefinitionV1 } from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { recoverWorkflowRuns } from './workflow-recovery-coordinator'
import { WorkflowStore } from './workflow-store'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

function createStore(): { store: WorkflowStore; path: string } {
  const path = join(tmpdir(), `orca-workflow-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  openStores.push(store)
  databasePaths.push(path)
  return { store, path }
}

function mutation(
  callerIdentity: string,
  requestId: string,
  method: string,
  payload: unknown
): {
  callerIdentity: string
  requestId: string
  method: string
  payload: unknown
} {
  return { callerIdentity, requestId, method, payload }
}

function fixtureDefinition(): WorkflowDefinitionV1 {
  return structuredClone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
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

describe('WorkflowStore templates', () => {
  it.runIf(process.platform !== 'win32')('uses owner-only database permissions', () => {
    const { path } = createStore()
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('seeds the three validated built-ins and enforces project identity scope', () => {
    const { store } = createStore()
    expect(
      store.listTemplates({ callerIdentity: 'user-a', projectIdentity: 'project-a' })
    ).toHaveLength(6)
    const projectTemplate = store.createTemplate(
      {
        name: 'Project flow',
        scope: 'project',
        projectIdentity: 'project-a',
        definition: fixtureDefinition()
      },
      mutation('user-a', 'create-project', 'workflow.templateCreate', { name: 'Project flow' })
    )
    expect(
      store
        .listTemplates({ callerIdentity: 'user-b', projectIdentity: 'project-a' })
        .map((row) => row.id)
    ).toContain(projectTemplate.id)
    expect(
      store
        .listTemplates({ callerIdentity: 'user-a', projectIdentity: 'project-b' })
        .map((row) => row.id)
    ).not.toContain(projectTemplate.id)
  })

  it('stamps decisionProtocolVersion when creating or updating a template', () => {
    const { store } = createStore()
    const definition = fixtureDefinition()
    delete definition.decisionProtocolVersion
    const created = store.createTemplate(
      { name: 'Protocol stamp flow', scope: 'personal', definition },
      mutation('user-a', 'create-protocol', 'workflow.templateCreate', {
        name: 'Protocol stamp flow'
      })
    )
    expect(created.definition.decisionProtocolVersion).toBe('v1-approve-revise')
    const updated = store.updateTemplate(
      {
        templateId: created.id,
        expectedVersion: 1,
        name: 'Protocol stamp flow',
        definition: { ...created.definition, decisionProtocolVersion: undefined }
      },
      mutation('user-a', 'update-protocol', 'workflow.templateUpdate', { templateId: created.id })
    )
    expect(updated.definition.decisionProtocolVersion).toBe('v1-approve-revise')
  })

  it('creates immutable versions and keeps an existing run snapshot stable', () => {
    const { store } = createStore()
    const template = store.createTemplate(
      { name: 'Personal flow', scope: 'personal', definition: fixtureDefinition() },
      mutation('user-a', 'create-personal', 'workflow.templateCreate', { name: 'Personal flow' })
    )
    const run = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'worktree-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'create-run', 'workflow.runCreate', { templateId: template.id })
    )
    const changed = structuredClone(template.definition)
    if (changed.schemaVersion !== 1) {
      throw new Error('expected V1 personal template in this test')
    }
    changed.nodes[0]!.name = 'Updated authoring'
    const updated = store.updateTemplate(
      {
        templateId: template.id,
        expectedVersion: 1,
        name: 'Personal flow renamed',
        definition: changed
      },
      mutation('user-a', 'update-template', 'workflow.templateUpdate', { templateId: template.id })
    )
    expect(updated.currentVersion).toBe(2)
    expect(store.showRun(run.id, 'user-a').templateSnapshot.nodes[0]!.name).not.toBe(
      'Updated authoring'
    )
  })

  it('archives custom templates without hiding history and replays mutations idempotently', () => {
    const { store } = createStore()
    const input = {
      name: 'Recoverable flow',
      scope: 'personal' as const,
      definition: fixtureDefinition()
    }
    const receipt = mutation('user-a', 'same-create', 'workflow.templateCreate', input)
    const first = store.createTemplate(input, receipt)
    const replay = store.createTemplate(input, receipt)
    expect(replay.id).toBe(first.id)
    const archived = store.archiveTemplate(
      { templateId: first.id },
      mutation('user-a', 'archive', 'workflow.templateArchive', { templateId: first.id })
    )
    expect(archived.archivedAt).not.toBeNull()
    expect(store.showTemplate({ templateId: first.id, callerIdentity: 'user-a' }).id).toBe(first.id)
    expect(() =>
      store.createRun(
        {
          templateId: first.id,
          projectIdentity: 'project-a',
          workspace: { kind: 'folder-workspace', id: 'folder-a' },
          executionHostId: 'local'
        },
        mutation('user-a', 'archived-run', 'workflow.runCreate', { templateId: first.id })
      )
    ).toThrow('Archived templates cannot create runs')
  })
})

describe('WorkflowStore runs', () => {
  it('switches a Draft template in place while preserving its objective', () => {
    const { store } = createStore()
    const created = store.createRun(
      {
        templateId: 'builtin.spec-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'worktree-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'switch-create', 'workflow.runCreate', {})
    )
    store.updateRunObjective(
      { runId: created.id, objective: 'Implement the selected SPEC.' },
      mutation('user-a', 'switch-objective', 'workflow.runUpdate', {})
    )
    const assigned = store.assignAgent(
      {
        runId: created.id,
        nodeId: 'spec-produce',
        slotId: 'spec-author',
        assignment: {
          worktreeId: 'worktree-a',
          executionHostId: 'local',
          paneKey: 'pane-author',
          agentLifecycleId: 'lifecycle-author',
          providerSessionId: null,
          runtimeAgent: 'codex'
        }
      },
      mutation('user-a', 'switch-assignment', 'workflow.runAssign', {})
    )
    const unchanged = store.switchRunTemplate(
      {
        runId: assigned.id,
        templateId: assigned.templateId,
        expectedVersion: assigned.version
      },
      mutation('user-a', 'switch-same-template', 'workflow.runSwitchTemplate', {})
    )
    expect(unchanged.assignments).toHaveLength(1)

    const switched = store.switchRunTemplate(
      {
        runId: unchanged.id,
        templateId: 'builtin.code-review.v1',
        expectedVersion: unchanged.version
      },
      mutation('user-a', 'switch-template', 'workflow.runSwitchTemplate', {})
    )

    expect(switched).toMatchObject({
      id: created.id,
      status: 'draft',
      templateId: 'builtin.code-review.v1',
      objective: 'Implement the selected SPEC.',
      assignments: []
    })
  })

  it('removes only the selected Agent from a parallel role slot', () => {
    const { store } = createStore()
    const run = store.createRun(
      {
        templateId: 'builtin.spec-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'worktree-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'remove-one-create', 'workflow.runCreate', {})
    )
    for (const lifecycleId of ['reviewer-one', 'reviewer-two']) {
      store.assignAgent(
        {
          runId: run.id,
          nodeId: 'spec-review',
          slotId: 'spec-reviewers',
          assignment: {
            worktreeId: 'worktree-a',
            executionHostId: 'local',
            paneKey: `pane-${lifecycleId}`,
            agentLifecycleId: lifecycleId,
            providerSessionId: null,
            runtimeAgent: 'codex'
          }
        },
        mutation('user-a', `remove-one-${lifecycleId}`, 'workflow.runAssign', {})
      )
    }

    const updated = store.assignAgent(
      {
        runId: run.id,
        nodeId: 'spec-review',
        slotId: 'spec-reviewers',
        assignment: null,
        removeAgentLifecycleId: 'reviewer-one'
      },
      mutation('user-a', 'remove-one-selected', 'workflow.runAssign', {})
    )

    expect(updated.assignments.map((assignment) => assignment.agentLifecycleId)).toEqual([
      'reviewer-two'
    ])
  })

  it('never reopens a cancelled Run through configuration mutations', () => {
    const { store } = createStore()
    const run = store.createRun(
      {
        templateId: 'builtin.spec-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'worktree-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'guard-create', 'workflow.runCreate', {})
    )
    const cancelled = store.cancelRun(
      {
        runId: run.id,
        expectedVersion: run.version,
        reason: 'Verify terminal-state guards.',
        confirmation: true,
        runningAgentAction: 'preserve-running'
      },
      mutation('user-a', 'guard-cancel', 'workflow.runCancel', {})
    )
    const action = 'Only a Draft or Ready Workflow can change its configuration.'

    expect(() =>
      store.updateRunObjective(
        { runId: run.id, objective: 'Reopen' },
        mutation('user-a', 'guard-objective', 'workflow.runUpdate', {})
      )
    ).toThrow(action)
    expect(() =>
      store.assignAgent(
        {
          runId: run.id,
          nodeId: 'spec-produce',
          slotId: 'spec-author',
          assignment: null
        },
        mutation('user-a', 'guard-assignment', 'workflow.runAssign', {})
      )
    ).toThrow(action)
    expect(() =>
      store.prepareRun(
        {
          runId: run.id,
          workspaceAvailable: true,
          capabilityAvailable: true,
          unavailableAgentLifecycleIds: []
        },
        mutation('user-a', 'guard-prepare', 'workflow.runPrepare', {})
      )
    ).toThrow(action)
    expect(() =>
      store.switchRunTemplate(
        {
          runId: run.id,
          templateId: 'builtin.code-review.v1',
          expectedVersion: cancelled.version
        },
        mutation('user-a', 'guard-switch', 'workflow.runSwitchTemplate', {})
      )
    ).toThrow(action)
    expect(store.showRun(run.id, 'user-a').status).toBe('cancelled')
  })

  it('assigns roles, saves the objective, and marks only a passing Draft ready', () => {
    const { store, path } = createStore()
    const run = store.createRun(
      {
        templateId: 'builtin.spec-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'worktree-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'run-create', 'workflow.runCreate', { template: 'builtin.spec-review.v1' })
    )
    const incomplete = store.prepareRun(
      {
        runId: run.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: []
      },
      mutation('user-a', 'preflight-fail', 'workflow.runPrepare', { runId: run.id })
    )
    expect(incomplete.ready).toBe(false)
    expect(incomplete.run.status).toBe('draft')

    const assigned = [
      ['spec-produce', 'spec-author', 'lifecycle-author'],
      ['spec-review', 'spec-reviewers', 'lifecycle-reviewer']
    ] as const
    for (const [nodeId, slotId, lifecycleId] of assigned) {
      store.assignAgent(
        {
          runId: run.id,
          nodeId,
          slotId,
          assignment: {
            worktreeId: 'worktree-a',
            executionHostId: 'local',
            paneKey: `pane-${lifecycleId}`,
            agentLifecycleId: lifecycleId,
            providerSessionId: null,
            runtimeAgent: 'codex'
          }
        },
        mutation('user-a', `assign-${lifecycleId}`, 'workflow.runAssign', { lifecycleId })
      )
    }
    store.updateRunObjective(
      { runId: run.id, objective: 'Write and review the M1 SPEC.' },
      mutation('user-a', 'objective', 'workflow.runUpdate', { runId: run.id })
    )
    const ready = store.prepareRun(
      {
        runId: run.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: []
      },
      mutation('user-a', 'preflight-pass', 'workflow.runPrepare', { runId: run.id })
    )
    expect(ready.ready).toBe(true)
    expect(ready.run.status).toBe('ready')
    const stale = store.prepareRun(
      {
        runId: run.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: ['lifecycle-reviewer']
      },
      mutation('user-a', 'preflight-stale', 'workflow.runPrepare', { runId: run.id })
    )
    expect(stale.ready).toBe(false)
    expect(stale.run.status).toBe('draft')

    const inspection = new Database(path, { readonly: true })
    const eventCount = inspection
      .prepare('SELECT count(*) AS count FROM workflow_events WHERE run_id = ?')
      .get(run.id) as { count: number }
    inspection.close()
    expect(eventCount.count).toBe(4)
  })

  it('rejects assignment context drift', () => {
    const { store } = createStore()
    const run = store.createRun(
      {
        templateId: 'builtin.code-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'ssh:build'
      },
      mutation('user-a', 'folder-run', 'workflow.runCreate', { workspace: 'folder-a' })
    )
    expect(() =>
      store.assignAgent(
        {
          runId: run.id,
          nodeId: 'code-produce',
          slotId: 'implementer',
          assignment: {
            worktreeId: 'folder-b',
            executionHostId: 'ssh:build',
            paneKey: 'pane-1',
            agentLifecycleId: 'agent-1',
            providerSessionId: null,
            runtimeAgent: 'codex'
          }
        },
        mutation('user-a', 'bad-assignment', 'workflow.runAssign', { paneKey: 'pane-1' })
      )
    ).toThrow('does not match the run')
  })

  it('filters owner-scoped history and exports one redacted authoritative snapshot', () => {
    const { store } = createStore()
    const first = store.createRun(
      {
        templateId: 'builtin.spec-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'history-first', 'workflow.runCreate', {})
    )
    store.updateRunObjective(
      {
        runId: first.id,
        objective: 'Use token=top-secret in /Users/alice/private/spec.md'
      },
      mutation('user-a', 'history-objective', 'workflow.runUpdate', {})
    )
    store.createRun(
      {
        templateId: 'builtin.code-review.v1',
        projectIdentity: 'project-b',
        workspace: { kind: 'git-worktree', id: 'worktree-b' },
        executionHostId: 'local'
      },
      mutation('user-a', 'history-second', 'workflow.runCreate', {})
    )
    store.createRun(
      {
        templateId: 'builtin.code-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'local'
      },
      mutation('user-b', 'history-foreign', 'workflow.runCreate', {})
    )

    expect(store.listRuns({ projectIdentity: 'project-a' }, 'user-a')).toHaveLength(1)
    expect(
      store.listRuns({ workspace: { kind: 'git-worktree', id: 'worktree-b' } }, 'user-a')
    ).toHaveLength(1)

    const json = store.exportRun(first.id, 'json', 'user-a')
    const markdown = store.exportRun(first.id, 'markdown', 'user-a')
    const parsed = JSON.parse(json.content) as {
      snapshotDigest: string
      run: { ownerIdentity: string; objective: string }
    }
    expect(parsed.run.ownerIdentity).toBe('[redacted]')
    expect(parsed.run.objective).toBe('Use token=[redacted] in ~/private/spec.md')
    expect(markdown.content).toContain(parsed.snapshotDigest)
    expect(markdown.content).not.toContain('top-secret')
    expect(json.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('preserves a non-terminal Run for evidence-based Runtime recovery', () => {
    const { store, path } = createStore()
    const run = store.createRun(
      {
        templateId: 'builtin.code-review.v1',
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'local'
      },
      mutation('user-a', 'restart-create', 'workflow.runCreate', {})
    )
    for (const [nodeId, slotId, lifecycleId] of [
      ['code-produce', 'implementer', 'producer'],
      ['code-review', 'code-reviewers', 'reviewer']
    ] as const) {
      store.assignAgent(
        {
          runId: run.id,
          nodeId,
          slotId,
          assignment: {
            worktreeId: 'folder-a',
            executionHostId: 'local',
            paneKey: `pane-${lifecycleId}`,
            agentLifecycleId: lifecycleId,
            providerSessionId: null,
            runtimeAgent: 'codex'
          }
        },
        mutation('user-a', `restart-${lifecycleId}`, 'workflow.runAssign', {})
      )
    }
    store.updateRunObjective(
      { runId: run.id, objective: 'Verify restart safety.' },
      mutation('user-a', 'restart-objective', 'workflow.runUpdate', {})
    )
    store.prepareRun(
      {
        runId: run.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: []
      },
      mutation('user-a', 'restart-prepare', 'workflow.runPrepare', {})
    )
    store.beginRun(
      { runId: run.id, baseline: { kind: 'folder-workspace' } },
      mutation('user-a', 'restart-start', 'workflow.runStart', {})
    )
    openStores.splice(openStores.indexOf(store), 1)
    store.close()

    const reopened = new WorkflowStore(path)
    openStores.push(reopened)
    expect(reopened.showRun(run.id, 'user-a')).toMatchObject({
      status: 'running',
      failureCode: null,
      recovery: null
    })
    expect(reopened.runEvents(run.id).events.at(-1)?.type).toBe('run-started')
  })

  it('resumes only prepared delivery and parks incomplete Dispatch evidence', async () => {
    const { store } = createStore()
    const prepared = createRunningRun(store, 'prepared')
    const uncertain = createRunningRun(store, 'uncertain')
    const uncertainStep = uncertain.steps[0]!
    store.setOrchestrationRun(uncertain.id, 'orchestration-uncertain')
    store.markStepDelivering({
      runId: uncertain.id,
      stepRunId: uncertainStep.id,
      taskId: 'task-missing',
      dispatchId: 'dispatch-missing',
      prompt: 'Persisted prompt'
    })
    const resumed: string[] = []
    await recoverWorkflowRuns({
      runtime: {} as OrcaRuntimeService,
      store,
      orchestration: {
        getTask: () => undefined,
        getDispatchContextById: () => undefined,
        getWorkerDispatch: () => undefined
      } as unknown as OrchestrationDb,
      recoveryOwnerId: 'runtime-test',
      resume: async (runId) => {
        resumed.push(runId)
      }
    })

    expect(resumed).toEqual([prepared.id])
    expect(store.showRun(uncertain.id, 'user-a')).toMatchObject({
      status: 'waiting-human',
      waitingReason: 'delivery-uncertain'
    })
    expect(store.runEvents(uncertain.id).events.at(-1)?.type).toBe('recovery-waiting')
  })

  it('isolates one unreadable Run without blocking later recovery candidates', async () => {
    const showRun = vi.fn((runId: string) => {
      if (runId === 'corrupt-run') {
        throw new Error('invalid template snapshot')
      }
      return { id: runId, status: 'paused' }
    })
    const onRunError = vi.fn()
    const store = {
      listRecoverableRunOwners: () => [
        { runId: 'corrupt-run', ownerIdentity: 'user-a' },
        { runId: 'healthy-run', ownerIdentity: 'user-a' }
      ],
      acquireRecoveryLease: () => true,
      showRun
    } as unknown as WorkflowStore

    await recoverWorkflowRuns({
      runtime: {} as OrcaRuntimeService,
      store,
      orchestration: {} as OrchestrationDb,
      recoveryOwnerId: 'runtime-test',
      resume: vi.fn(),
      onRunError
    })

    expect(showRun).toHaveBeenCalledWith('healthy-run', 'user-a')
    expect(onRunError).toHaveBeenCalledWith(
      { runId: 'corrupt-run', ownerIdentity: 'user-a' },
      expect.any(Error)
    )
  })

  it('does not duplicate delivery events when the same persisted receipt is replayed', () => {
    const { store } = createStore()
    const run = createRunningRun(store, 'delivery-replay')
    const step = run.steps[0]!
    const delivery = {
      runId: run.id,
      stepRunId: step.id,
      taskId: 'task-delivery-replay',
      dispatchId: 'dispatch-delivery-replay',
      prompt: 'Persisted prompt'
    }
    store.markStepDelivering(delivery)
    store.markStepDelivering(delivery)
    store.markStepRunning({
      runId: run.id,
      stepRunId: step.id,
      receipt: { accepted: true }
    })
    store.markStepRunning({
      runId: run.id,
      stepRunId: step.id,
      receipt: { accepted: true }
    })

    const eventTypes = store.runEvents(run.id).events.map((event) => event.type)
    expect(eventTypes.filter((type) => type === 'prompt-delivery-started')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'prompt-delivered')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'step-working')).toHaveLength(1)
  })

  it('keeps delivery separate from the Agent working hook', () => {
    const { store } = createStore()
    const run = createRunningRun(store, 'hook-start')
    const step = run.steps[0]!
    store.markStepDelivering({
      runId: run.id,
      stepRunId: step.id,
      taskId: 'task-hook-start',
      dispatchId: 'dispatch-hook-start',
      prompt: 'Start from the Agent hook.'
    })
    store.markStepDelivered({
      runId: run.id,
      stepRunId: step.id,
      receipt: { accepted: true }
    })

    expect(store.getStep(step.id)).toMatchObject({
      status: 'delivering',
      deliveryState: 'delivered',
      startedAt: null
    })
    store.markStepWorking({
      runId: run.id,
      stepRunId: step.id,
      source: 'agent-status-hook'
    })
    expect(store.getStep(step.id)).toMatchObject({
      status: 'running',
      startedAt: expect.any(String)
    })
  })
})

function createRunningRun(store: WorkflowStore, prefix: string) {
  let run = store.createRun(
    {
      templateId: 'builtin.code-review.v1',
      projectIdentity: 'project-a',
      workspace: { kind: 'folder-workspace', id: `folder-${prefix}` },
      executionHostId: 'local'
    },
    mutation('user-a', `${prefix}-create`, 'workflow.runCreate', {})
  )
  for (const [nodeId, slotId, lifecycleId] of [
    ['code-produce', 'implementer', `${prefix}-producer`],
    ['code-review', 'code-reviewers', `${prefix}-reviewer`]
  ] as const) {
    run = store.assignAgent(
      {
        runId: run.id,
        nodeId,
        slotId,
        assignment: {
          worktreeId: `folder-${prefix}`,
          executionHostId: 'local',
          paneKey: `pane-${lifecycleId}`,
          agentLifecycleId: lifecycleId,
          providerSessionId: null,
          runtimeAgent: 'codex'
        }
      },
      mutation('user-a', `${prefix}-${lifecycleId}`, 'workflow.runAssign', {})
    )
  }
  store.updateRunObjective(
    { runId: run.id, objective: `Recover ${prefix}.` },
    mutation('user-a', `${prefix}-objective`, 'workflow.runUpdate', {})
  )
  store.prepareRun(
    {
      runId: run.id,
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    },
    mutation('user-a', `${prefix}-prepare`, 'workflow.runPrepare', {})
  )
  return store.beginRun(
    { runId: run.id, baseline: { kind: 'folder-workspace' } },
    mutation('user-a', `${prefix}-start`, 'workflow.runStart', {})
  )
}
