import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { workflowReviewRoundLimit } from '../../../shared/workflow-review-round-budget'
import { WorkflowStore } from './workflow-store'

const openStores: WorkflowStore[] = []
const databasePaths: string[] = []

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-rerun-${randomUUID()}.db`)
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

function mutation(requestId: string) {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: 'workflow.runCreateRerun',
    payload: { requestId }
  }
}

describe('workflow run rerun lineage', () => {
  it('persists versioned run policy and prompt overrides with optimistic concurrency', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_TEMPLATES[0]!
    const run = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-1' },
        executionHostId: 'local'
      },
      mutation('create-configurable')
    )
    if (run.templateSnapshot.schemaVersion !== 1) {
      throw new Error('expected V1 fixture')
    }
    const reviewId = run.templateSnapshot.nodes.find((node) => node.type === 'review')!.id
    const produceId = run.templateSnapshot.entryNodeId
    const configured = store.updateRunConfiguration(
      {
        runId: run.id,
        expectedVersion: run.version,
        objective: 'Configured objective',
        policyOverrides: {
          policyVersion: 'v1-review-rounds',
          maxReviewRoundsByNodeId: { [reviewId]: 2 }
        },
        promptOverrides: { [produceId]: { firstVisit: 'Run-only prompt' } }
      },
      mutation('configure-run')
    )
    expect(configured).toMatchObject({
      objective: 'Configured objective',
      policyOverrides: {
        policyVersion: 'v1-review-rounds',
        maxReviewRoundsByNodeId: { [reviewId]: 2 }
      },
      promptOverrides: { [produceId]: { firstVisit: 'Run-only prompt' } }
    })
    expect(() =>
      store.updateRunConfiguration(
        {
          runId: run.id,
          expectedVersion: run.version,
          objective: 'Stale',
          policyOverrides: null,
          promptOverrides: null
        },
        mutation('stale-configure')
      )
    ).toThrow(/changed/)
    const summary = store
      .listRuns({ projectIdentity: 'project-a' }, 'user-a')
      .find((row) => row.id === run.id)
    expect(summary).toMatchObject({
      policyOverrideVersion: 'v1-review-rounds',
      promptOverrideNodeIds: [produceId]
    })
    expect(summary?.businessBudgetSummary).toContain(`${reviewId}: 0/2`)
    expect(summary?.businessBudgetSummary).toContain('override 2')
  })

  it('creates an idempotent child draft from a completed parent with lineage', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_TEMPLATES[0]!
    let parent = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-1' },
        executionHostId: 'local'
      },
      mutation('create-parent')
    )
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      )
      .run(parent.id)
    parent = store.showRun(parent.id, 'user-a')
    if (parent.templateSnapshot.schemaVersion !== 1) {
      throw new Error('expected V1 fixture')
    }
    expect(parent.rootRunId).toBe(parent.id)
    expect(parent.parentRunId).toBeNull()

    const child = store.createRunRerun(
      {
        parentRunId: parent.id,
        noAdditionalRequirements: true,
        policyOverrides: {
          policyVersion: 'v1-review-rounds',
          maxReviewRoundsByNodeId: {
            [parent.templateSnapshot.nodes.find((n) => n.type === 'review')!.id]: 3
          }
        }
      },
      mutation('create-child')
    )
    expect(child.status).toBe('draft')
    expect(child.parentRunId).toBe(parent.id)
    expect(child.rootRunId).toBe(parent.id)
    expect(child.noAdditionalRequirements).toBe(true)
    expect(child.templateSnapshot).toEqual(parent.templateSnapshot)

    const reviewId = parent.templateSnapshot.nodes.find((n) => n.type === 'review')!.id
    expect(workflowReviewRoundLimit(child, reviewId)).toBe(3)

    const again = store.createRunRerun(
      {
        parentRunId: parent.id,
        noAdditionalRequirements: true
      },
      mutation('create-child')
    )
    expect(again.id).toBe(child.id)

    const history = store.listRuns({ projectIdentity: 'project-a' }, 'user-a')
    const childSummary = history.find((row) => row.id === child.id)
    expect(childSummary).toMatchObject({
      isRerun: true,
      parentRunId: parent.id,
      rootRunId: parent.id
    })
  })

  it('rejects rerun from non-completed parents and invalid requirement pairs', () => {
    const store = createStore()
    const template = BUILTIN_WORKFLOW_TEMPLATES[0]!
    const draft = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'git-worktree', id: 'wt-1' },
        executionHostId: 'local'
      },
      mutation('draft')
    )
    expect(() =>
      store.createRunRerun(
        { parentRunId: draft.id, noAdditionalRequirements: true },
        mutation('bad-status')
      )
    ).toThrow(/completed/)

    store.persistenceDb
      .prepare(`UPDATE workflow_runs SET status = 'completed' WHERE id = ?`)
      .run(draft.id)
    expect(() =>
      store.createRunRerun({ parentRunId: draft.id }, mutation('missing-reason'))
    ).toThrow(/rerun reason/)
    expect(() =>
      store.createRunRerun(
        { parentRunId: draft.id, rerunReason: 'fix', noAdditionalRequirements: true },
        mutation('both')
      )
    ).toThrow(/rerun reason/)
  })
})
