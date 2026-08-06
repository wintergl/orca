import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from '../../../shared/workflow-v2-fixtures'
import type { WorkflowMutation } from './workflow-mutation-ledger'
import { WorkflowStore } from './workflow-store'

let store: WorkflowStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

function mutation(requestId: string, method: string): WorkflowMutation {
  return { callerIdentity: 'user-a', requestId, method, payload: {} }
}

describe('default V2 workflow configurations', () => {
  it('seeds only SPEC review and code review as visible V2 defaults', () => {
    store = new WorkflowStore(':memory:')
    expect(
      store
        .listTemplates({ callerIdentity: 'user-a', schemaVersion: 2 })
        .map((template) => [template.id, template.name])
    ).toEqual([
      ['builtin.v2.spec-review', 'SPEC 编写 + 评审'],
      ['builtin.v2.code-review', '代码编写 + 评审']
    ])
  })

  it('can be edited, deleted, and reset to the packaged configuration', () => {
    store = new WorkflowStore(':memory:')
    const fixture = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!
    const original = store.showTemplate({ templateId: fixture.id, callerIdentity: 'user-a' })
    const changed = structuredClone(fixture.definition)
    changed.steps[0]!.name = 'Customized step'
    const edited = store.updateTemplate(
      {
        templateId: original.id,
        expectedVersion: original.currentVersion,
        name: 'Customized default',
        definition: changed
      },
      mutation('edit-default-v2', 'workflow.templateUpdate')
    )
    store.archiveTemplate(
      { templateId: edited.id },
      mutation('delete-default-v2', 'workflow.templateArchive')
    )
    expect(
      store
        .listTemplates({ callerIdentity: 'user-a', schemaVersion: 2 })
        .some((template) => template.id === fixture.id)
    ).toBe(false)

    const restored = store.resetDefaultWorkflowConfigurations(
      mutation('reset-default-v2', 'workflow.templateResetDefaults')
    )
    const reset = restored.find((template) => template.id === fixture.id)!
    expect(reset).toMatchObject({
      name: fixture.name,
      archivedAt: null,
      definition: fixture.definition
    })
    expect(reset.currentVersion).toBe(edited.currentVersion + 1)
  })

  it('archives retired V2 demo defaults when defaults are reset', () => {
    store = new WorkflowStore(':memory:')
    const fixture = BUILTIN_WORKFLOW_V2_TEMPLATES[0]!
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_templates (
           id, name, scope, owner_identity, project_identity, current_version
         ) VALUES (?, ?, 'built-in', 'orca', NULL, 1)`
      )
      .run('builtin.v2.single-agent-end', 'Retired demo')
    store.persistenceDb
      .prepare(
        `INSERT INTO workflow_template_versions (
           template_id, version, definition_json, created_by
         ) VALUES (?, 1, ?, 'orca')`
      )
      .run('builtin.v2.single-agent-end', JSON.stringify(fixture.definition))

    store.resetDefaultWorkflowConfigurations(
      mutation('retire-demo-default', 'workflow.templateResetDefaults')
    )

    const retired = store
      .listTemplates({ callerIdentity: 'user-a', schemaVersion: 2, includeArchived: true })
      .find((template) => template.id === 'builtin.v2.single-agent-end')
    expect(retired?.archivedAt).not.toBeNull()
    expect(
      store
        .listTemplates({ callerIdentity: 'user-a', schemaVersion: 2 })
        .map((template) => template.id)
    ).toEqual(['builtin.v2.spec-review', 'builtin.v2.code-review'])
  })
})
