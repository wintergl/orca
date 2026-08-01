import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { createWorkflowTables } from './workflow-database-schema'
import { seedBuiltinWorkflowTemplates } from './workflow-database-seed'

let db: Database.Database | null = null

afterEach(() => {
  db?.close()
  db = null
})

describe('Workflow built-in template seed', () => {
  it('advances an existing built-in to the newest immutable fixture version', () => {
    db = new Database(':memory:')
    createWorkflowTables(db)
    const fixture = BUILTIN_WORKFLOW_TEMPLATES[0]!
    db.prepare(
      `INSERT INTO workflow_templates (
         id, name, scope, owner_identity, project_identity, current_version
       ) VALUES (?, 'Legacy built-in', 'built-in', 'orca', NULL, 1)`
    ).run(fixture.id)
    db.prepare(
      `INSERT INTO workflow_template_versions (
         template_id, version, definition_json, created_by
       ) VALUES (?, 1, '{"legacy":true}', 'orca')`
    ).run(fixture.id)

    seedBuiltinWorkflowTemplates(db)
    seedBuiltinWorkflowTemplates(db)

    const template = db
      .prepare('SELECT name, current_version FROM workflow_templates WHERE id = ?')
      .get(fixture.id) as { name: string; current_version: number }
    const versions = db
      .prepare(
        'SELECT version FROM workflow_template_versions WHERE template_id = ? ORDER BY version'
      )
      .all(fixture.id) as { version: number }[]
    expect(template).toEqual({ name: fixture.name, current_version: fixture.version })
    expect(versions.map((row) => row.version)).toEqual([1, fixture.version])
  })
})
