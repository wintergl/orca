import type Database from '../../sqlite/sync-database'
import { RETIRED_BUILTIN_WORKFLOW_V2_TEMPLATE_IDS } from '../../../shared/workflow-v2-fixtures'

export function archiveRetiredWorkflowV2Configurations(db: Database.Database): void {
  const statement = db.prepare(
    `UPDATE workflow_templates
     SET archived_at = COALESCE(archived_at, datetime('now')),
         archived_by = COALESCE(archived_by, 'orca'),
         updated_at = CASE WHEN archived_at IS NULL THEN datetime('now') ELSE updated_at END
     WHERE id = ? AND scope = 'built-in'`
  )
  for (const templateId of RETIRED_BUILTIN_WORKFLOW_V2_TEMPLATE_IDS) {
    statement.run(templateId)
  }
}
