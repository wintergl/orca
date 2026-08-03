import type Database from '../../sqlite/sync-database'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from '../../../shared/workflow-v2-fixtures'

export function seedBuiltinWorkflowTemplates(db: Database.Database): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const fixture of [...BUILTIN_WORKFLOW_TEMPLATES, ...BUILTIN_WORKFLOW_V2_TEMPLATES]) {
      db.prepare(
        `INSERT OR IGNORE INTO workflow_templates (
           id, name, scope, owner_identity, project_identity, current_version
         ) VALUES (?, ?, 'built-in', 'orca', NULL, ?)`
      ).run(fixture.id, fixture.name, fixture.version)
      db.prepare(
        `INSERT OR IGNORE INTO workflow_template_versions (
           template_id, version, definition_json, created_by
         ) VALUES (?, ?, ?, 'orca')`
      ).run(fixture.id, fixture.version, JSON.stringify(fixture.definition))
      db.prepare(
        `UPDATE workflow_templates
         SET name = ?, current_version = ?, updated_at = datetime('now')
         WHERE id = ? AND scope = 'built-in' AND current_version < ?`
      ).run(fixture.name, fixture.version, fixture.id, fixture.version)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
