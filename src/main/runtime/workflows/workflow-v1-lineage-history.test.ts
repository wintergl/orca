import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { getBuiltinWorkflowTemplate } from '../../../shared/workflow-fixtures'
import { workflowDefinitionV1Schema } from '../../../shared/workflow-definition-schema'
import { renderWorkflowNodeInstructions } from './workflow-prompt-context'
import { WorkflowStore } from './workflow-store'

const stores: WorkflowStore[] = []
const paths: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
  for (const path of paths.splice(0)) {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      rmSync(file, { force: true })
    }
  }
})

describe('V1 lineage prompt history', () => {
  it('renders child repeat prompt from the completed parent lineage cycle', () => {
    const store = createStore()
    const definition = structuredClone(
      getBuiltinWorkflowTemplate('builtin.spec-review.v1')!.definition
    )
    const produce = definition.nodes.find((node) => node.id === 'spec-produce')!
    produce.promptInstructions = null
    produce.promptRules = {
      rules: [
        {
          id: 'first',
          name: 'First',
          when: 'first-visit',
          template: 'first {{goal}} {{criteria}}'
        },
        {
          id: 'repeat',
          name: 'Repeat',
          when: 'repeat-visit',
          template: 'parent: {{ history[-1].nodes["spec-produce"].output }} {{criteria}}'
        }
      ],
      completionCriteria: 'done'
    }
    const parsed = workflowDefinitionV1Schema.safeParse(definition)
    if (!parsed.success) {
      throw new Error(parsed.error.message)
    }
    const template = store.createTemplate(
      { name: 'Lineage prompt', scope: 'personal', definition },
      mutation('template')
    )
    const parent = store.createRun(
      {
        templateId: template.id,
        projectIdentity: 'project-a',
        workspace: { kind: 'folder-workspace', id: 'folder-a' },
        executionHostId: 'local'
      },
      mutation('parent')
    )
    const parentStep = store.insertStep(parent.id, produce, assignment(), null, 'queued', 2, 1)
    store.persistenceDb
      .prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = 'parent cycle two',
             completed_at = datetime('now') WHERE id = ?`
      )
      .run(parentStep.id)
    store.persistenceDb
      .prepare(
        `UPDATE workflow_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      )
      .run(parent.id)
    const child = store.createRunRerun(
      { parentRunId: parent.id, noAdditionalRequirements: true },
      mutation('child')
    )
    const childStep = store.insertStep(child.id, produce, assignment(), null, 'queued', 1, 1)
    const hydrated = store.showRun(child.id, 'user-a')
    expect(hydrated.lineageCycleBase).toBe(2)
    expect(renderWorkflowNodeInstructions(hydrated, childStep, store.persistenceDb)).toBe(
      'parent: parent cycle two done'
    )
    const preflight = store.prepareRun(
      {
        runId: child.id,
        workspaceAvailable: true,
        capabilityAvailable: true,
        unavailableAgentLifecycleIds: []
      },
      mutation('child-preflight')
    )
    expect(
      preflight.promptPreviews.find((preview) => preview.nodeId === 'spec-produce')
    ).toMatchObject({
      firstVisit: expect.stringContaining('first'),
      repeatVisit: 'parent: parent cycle two done'
    })
  })
})

function createStore(): WorkflowStore {
  const path = join(tmpdir(), `orca-workflow-lineage-${randomUUID()}.db`)
  const store = new WorkflowStore(path)
  stores.push(store)
  paths.push(path)
  return store
}

function mutation(requestId: string) {
  return {
    callerIdentity: 'user-a',
    requestId,
    method: `test.${requestId}`,
    payload: { requestId }
  }
}

function assignment() {
  return {
    nodeId: 'spec-produce',
    slotId: 'spec-author',
    worktreeId: 'folder-a',
    executionHostId: 'local',
    paneKey: 'pane-author',
    agentLifecycleId: 'author',
    providerSessionId: 'session-author',
    runtimeAgent: 'codex'
  }
}
