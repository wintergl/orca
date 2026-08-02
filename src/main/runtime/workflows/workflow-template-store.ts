import { randomBytes } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import type {
  WorkflowDefinitionV1,
  WorkflowTemplateRecord,
  WorkflowTemplateScope
} from '../../../shared/workflow-definition-types'
import { stampWorkflowDecisionProtocolVersionV1 } from '../../../shared/workflow-decision-protocol'
import { WorkflowError } from './workflow-error'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import {
  parseStoredWorkflowDefinition,
  toWorkflowTemplateRecord,
  type WorkflowTemplateRow
} from './workflow-store-records'

export class WorkflowTemplateStore {
  constructor(private readonly db: Database.Database) {}

  list(params: {
    callerIdentity: string
    projectIdentity?: string
    includeArchived?: boolean
  }): WorkflowTemplateRecord[] {
    const archivedClause = params.includeArchived ? '' : 'AND t.archived_at IS NULL'
    const rows = this.db
      .prepare(
        `SELECT t.*, v.definition_json
         FROM workflow_templates t
         JOIN workflow_template_versions v
           ON v.template_id = t.id AND v.version = t.current_version
         WHERE (
           t.scope = 'built-in'
           OR (t.scope = 'personal' AND t.owner_identity = ?)
           OR (t.scope = 'project' AND t.project_identity = ?)
         ) ${archivedClause}
         ORDER BY CASE t.scope WHEN 'built-in' THEN 0 WHEN 'personal' THEN 1 ELSE 2 END,
                  lower(t.name), t.id`
      )
      .all(params.callerIdentity, params.projectIdentity ?? null) as WorkflowTemplateRow[]
    return rows.map(toWorkflowTemplateRecord)
  }

  show(params: {
    templateId: string
    callerIdentity: string
    projectIdentity?: string
  }): WorkflowTemplateRecord {
    const row = this.getRow(params.templateId)
    this.assertVisible(row, params.callerIdentity, params.projectIdentity)
    return toWorkflowTemplateRecord(row)
  }

  create(
    params: {
      name: string
      scope: Exclude<WorkflowTemplateScope, 'built-in'>
      projectIdentity?: string
      definition: unknown
    },
    mutation: WorkflowMutation
  ): WorkflowTemplateRecord {
    const definition = stampWorkflowDecisionProtocolVersionV1(
      parseStoredWorkflowDefinition(params.definition)
    )
    return runWorkflowMutation(this.db, mutation, () => {
      this.assertProjectScope(params.scope, params.projectIdentity)
      this.assertNameAvailable(
        params.name,
        params.scope,
        mutation.callerIdentity,
        params.projectIdentity
      )
      const id = `workflow_template_${randomBytes(9).toString('hex')}`
      this.db
        .prepare(
          `INSERT INTO workflow_templates (
             id, name, scope, owner_identity, project_identity, current_version
           ) VALUES (?, ?, ?, ?, ?, 1)`
        )
        .run(
          id,
          params.name.trim(),
          params.scope,
          mutation.callerIdentity,
          params.projectIdentity ?? null
        )
      this.insertVersion(id, 1, definition, mutation.callerIdentity)
      return this.show({
        templateId: id,
        callerIdentity: mutation.callerIdentity,
        projectIdentity: params.projectIdentity
      })
    })
  }

  update(
    params: {
      templateId: string
      expectedVersion: number
      name: string
      definition: unknown
      projectIdentity?: string
    },
    mutation: WorkflowMutation
  ): WorkflowTemplateRecord {
    const definition = stampWorkflowDecisionProtocolVersionV1(
      parseStoredWorkflowDefinition(params.definition)
    )
    return runWorkflowMutation(this.db, mutation, () => {
      const row = this.getRow(params.templateId)
      this.assertMutable(row, mutation.callerIdentity, params.projectIdentity)
      if (row.current_version !== params.expectedVersion) {
        throw new WorkflowError(
          'workflow_version_conflict',
          `Template version ${params.expectedVersion} is stale.`,
          { currentVersion: row.current_version }
        )
      }
      this.assertNameAvailable(
        params.name,
        row.scope,
        mutation.callerIdentity,
        row.project_identity ?? undefined,
        row.id
      )
      const nextVersion = row.current_version + 1
      this.insertVersion(row.id, nextVersion, definition, mutation.callerIdentity)
      this.db
        .prepare(
          `UPDATE workflow_templates
           SET name = ?, current_version = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(params.name.trim(), nextVersion, row.id)
      return this.show({
        templateId: row.id,
        callerIdentity: mutation.callerIdentity,
        projectIdentity: params.projectIdentity
      })
    })
  }

  clone(
    params: {
      sourceTemplateId: string
      name: string
      scope: Exclude<WorkflowTemplateScope, 'built-in'>
      sourceProjectIdentity?: string
      projectIdentity?: string
    },
    mutation: WorkflowMutation
  ): WorkflowTemplateRecord {
    const source = this.show({
      templateId: params.sourceTemplateId,
      callerIdentity: mutation.callerIdentity,
      projectIdentity: params.sourceProjectIdentity
    })
    return this.create(
      {
        name: params.name,
        scope: params.scope,
        projectIdentity: params.projectIdentity,
        definition: source.definition
      },
      mutation
    )
  }

  archive(
    params: { templateId: string; projectIdentity?: string },
    mutation: WorkflowMutation
  ): WorkflowTemplateRecord {
    return runWorkflowMutation(this.db, mutation, () => {
      const row = this.getRow(params.templateId)
      this.assertMutable(row, mutation.callerIdentity, params.projectIdentity)
      this.db
        .prepare(
          `UPDATE workflow_templates
           SET archived_at = datetime('now'), archived_by = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(mutation.callerIdentity, row.id)
      return this.show({
        templateId: row.id,
        callerIdentity: mutation.callerIdentity,
        projectIdentity: params.projectIdentity
      })
    })
  }

  private getRow(templateId: string): WorkflowTemplateRow {
    const row = this.db
      .prepare(
        `SELECT t.*, v.definition_json
         FROM workflow_templates t
         JOIN workflow_template_versions v
           ON v.template_id = t.id AND v.version = t.current_version
         WHERE t.id = ?`
      )
      .get(templateId) as WorkflowTemplateRow | undefined
    if (!row) {
      throw new WorkflowError(
        'workflow_not_found',
        `Workflow template ${templateId} was not found.`
      )
    }
    return row
  }

  private assertVisible(
    row: WorkflowTemplateRow,
    callerIdentity: string,
    projectIdentity?: string
  ): void {
    if (row.scope === 'built-in') {
      return
    }
    if (row.scope === 'personal' && row.owner_identity === callerIdentity) {
      return
    }
    if (row.scope === 'project' && row.project_identity === projectIdentity) {
      return
    }
    throw new WorkflowError('workflow_forbidden', 'Workflow template is outside this scope.')
  }

  private assertMutable(
    row: WorkflowTemplateRow,
    callerIdentity: string,
    projectIdentity?: string
  ): void {
    this.assertVisible(row, callerIdentity, projectIdentity)
    if (row.scope === 'built-in') {
      throw new WorkflowError(
        'workflow_forbidden',
        'Built-in templates must be cloned before editing.'
      )
    }
    if (row.archived_at) {
      throw new WorkflowError('workflow_archived', 'Archived templates are read-only.')
    }
  }

  private assertProjectScope(scope: WorkflowTemplateScope, projectIdentity?: string): void {
    if (scope === 'project' && !projectIdentity?.trim()) {
      throw new WorkflowError(
        'workflow_context_mismatch',
        'Project templates require an exact Project Identity.'
      )
    }
  }

  private assertNameAvailable(
    name: string,
    scope: WorkflowTemplateScope,
    ownerIdentity: string,
    projectIdentity?: string,
    excludingId?: string
  ): void {
    const row = this.db
      .prepare(
        `SELECT id FROM workflow_templates
         WHERE scope = ? AND owner_identity = ? AND ifnull(project_identity, '') = ifnull(?, '')
           AND name = ? AND archived_at IS NULL AND id <> ?`
      )
      .get(
        scope,
        scope === 'built-in' ? 'orca' : ownerIdentity,
        projectIdentity ?? null,
        name.trim(),
        excludingId ?? ''
      ) as { id: string } | undefined
    if (row) {
      throw new WorkflowError(
        'workflow_name_conflict',
        `A ${scope} template named "${name.trim()}" already exists.`
      )
    }
  }

  private insertVersion(
    templateId: string,
    version: number,
    definition: WorkflowDefinitionV1,
    createdBy: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO workflow_template_versions (
           template_id, version, definition_json, created_by
         ) VALUES (?, ?, ?, ?)`
      )
      .run(templateId, version, JSON.stringify(definition), createdBy)
  }
}
