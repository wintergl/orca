import type Database from '../../sqlite/sync-database'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import { insertWorkflowEvent } from './workflow-event-store'
import { runWorkflowMutation, type WorkflowMutation } from './workflow-mutation-ledger'
import { assertWorkflowRunConfigurable } from './workflow-run-configuration-guard'
import type { WorkflowRunStore } from './workflow-run-store'
import type { WorkflowTemplateStore } from './workflow-template-store'

export function switchWorkflowRunTemplate(
  db: Database.Database,
  runs: WorkflowRunStore,
  templates: WorkflowTemplateStore,
  params: { runId: string; templateId: string; expectedVersion: number },
  mutation: WorkflowMutation
): WorkflowRunRecord {
  return runWorkflowMutation(db, mutation, () => {
    const run = runs.show(params.runId, mutation.callerIdentity)
    assertWorkflowRunConfigurable(run)
    if (run.version !== params.expectedVersion) {
      throw new WorkflowError(
        'workflow_version_conflict',
        `Workflow Run version ${params.expectedVersion} is stale.`
      )
    }
    const template = templates.show({
      templateId: params.templateId,
      callerIdentity: mutation.callerIdentity,
      projectIdentity: run.projectIdentity
    })
    if (template.archivedAt) {
      throw new WorkflowError('workflow_archived', 'Archived templates cannot create runs.')
    }
    if (template.id === run.templateId && template.currentVersion === run.templateVersion) {
      return run
    }
    db.prepare('DELETE FROM workflow_agent_assignments WHERE run_id = ?').run(run.id)
    db.prepare(
      `UPDATE workflow_runs
       SET template_id = ?, template_version = ?, template_name = ?,
           template_snapshot_json = ?, status = 'draft', current_node_id = NULL,
           waiting_reason = NULL, version = version + 1, updated_at = datetime('now')
       WHERE id = ? AND version = ?`
    ).run(
      template.id,
      template.currentVersion,
      template.name,
      JSON.stringify(template.definition),
      run.id,
      run.version
    )
    insertWorkflowEvent(db, run.id, 'template-applied', null, {
      templateId: template.id,
      templateVersion: template.currentVersion,
      replacedTemplateId: run.templateId,
      replacedTemplateVersion: run.templateVersion
    })
    return runs.show(run.id, mutation.callerIdentity)
  })
}
