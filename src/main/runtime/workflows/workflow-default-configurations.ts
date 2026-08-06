import type Database from '../../sqlite/sync-database'
import type { WorkflowTemplateRecord } from '../../../shared/workflow-definition-types'
import { BUILTIN_WORKFLOW_V2_TEMPLATES } from '../../../shared/workflow-v2-fixtures'
import { WorkflowError } from './workflow-error'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { archiveRetiredWorkflowV2Configurations } from './workflow-retired-default-configurations'
import { toWorkflowTemplateRecord, type WorkflowTemplateRow } from './workflow-store-records'

const ACTIVE_RUN_COUNT_SQL = `(SELECT COUNT(*) FROM workflow_runs r
  WHERE r.template_id = t.id
    AND r.status IN ('running', 'paused', 'waiting-human', 'review-limit-reached'))`

export function resetDefaultWorkflowConfigurations(
  db: Database.Database,
  mutation: WorkflowMutation
): WorkflowTemplateRecord[] {
  return runWorkflowMutation(db, mutation, () => {
    assertDefaultConfigurationsIdle(db)
    archiveRetiredWorkflowV2Configurations(db)
    for (const fixture of BUILTIN_WORKFLOW_V2_TEMPLATES) {
      restoreDefaultConfiguration(db, fixture, mutation.callerIdentity)
    }
    return BUILTIN_WORKFLOW_V2_TEMPLATES.map((fixture) => readDefaultConfiguration(db, fixture.id))
  })
}

function assertDefaultConfigurationsIdle(db: Database.Database): void {
  const ids = BUILTIN_WORKFLOW_V2_TEMPLATES.map((fixture) => fixture.id)
  const rows = db
    .prepare(
      `SELECT t.id, ${ACTIVE_RUN_COUNT_SQL} AS active_run_count
       FROM workflow_templates t WHERE t.id IN (${ids.map(() => '?').join(', ')})`
    )
    .all(...ids) as { id: string; active_run_count: number }[]
  const active = rows.find((row) => row.active_run_count > 0)
  if (active) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Default workflow configurations cannot be reset while one or more runs are active.',
      { templateId: active.id, activeRunCount: active.active_run_count }
    )
  }
}

function restoreDefaultConfiguration(
  db: Database.Database,
  fixture: (typeof BUILTIN_WORKFLOW_V2_TEMPLATES)[number],
  callerIdentity: string
): void {
  const row = readDefaultConfigurationRow(db, fixture.id)
  if (!row) {
    db.prepare('DELETE FROM workflow_template_versions WHERE template_id = ?').run(fixture.id)
    db.prepare(
      `INSERT INTO workflow_templates (
         id, name, scope, owner_identity, project_identity, current_version
       ) VALUES (?, ?, 'built-in', 'orca', NULL, ?)`
    ).run(fixture.id, fixture.name, fixture.version)
    insertVersion(db, fixture.id, fixture.version, fixture.definition, callerIdentity)
    return
  }
  if (
    row.name === fixture.name &&
    row.archived_at === null &&
    row.definition_json === JSON.stringify(fixture.definition)
  ) {
    return
  }
  const nextVersion = row.current_version + 1
  insertVersion(db, fixture.id, nextVersion, fixture.definition, callerIdentity)
  db.prepare(
    `UPDATE workflow_templates
     SET name = ?, current_version = ?, archived_at = NULL, archived_by = NULL,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(fixture.name, nextVersion, fixture.id)
}

function readDefaultConfiguration(
  db: Database.Database,
  templateId: string
): WorkflowTemplateRecord {
  const row = readDefaultConfigurationRow(db, templateId)
  if (!row) {
    throw new WorkflowError('workflow_not_found', `Workflow template ${templateId} was not found.`)
  }
  return toWorkflowTemplateRecord(row)
}

function readDefaultConfigurationRow(
  db: Database.Database,
  templateId: string
): WorkflowTemplateRow | undefined {
  return db
    .prepare(
      `SELECT t.*, v.definition_json, ${ACTIVE_RUN_COUNT_SQL} AS active_run_count
       FROM workflow_templates t
       JOIN workflow_template_versions v
         ON v.template_id = t.id AND v.version = t.current_version
       WHERE t.id = ?`
    )
    .get(templateId) as WorkflowTemplateRow | undefined
}

function insertVersion(
  db: Database.Database,
  templateId: string,
  version: number,
  definition: unknown,
  createdBy: string
): void {
  db.prepare(
    `INSERT INTO workflow_template_versions (
       template_id, version, definition_json, created_by
     ) VALUES (?, ?, ?, ?)`
  ).run(templateId, version, JSON.stringify(definition), createdBy)
}
