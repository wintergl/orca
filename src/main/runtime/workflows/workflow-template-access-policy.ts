import { WorkflowError } from './workflow-error'
import type { WorkflowTemplateRow } from './workflow-store-records'

export function assertWorkflowTemplateEditable(row: WorkflowTemplateRow): void {
  if (row.archived_at) {
    throw new WorkflowError('workflow_archived', 'Archived templates are read-only.')
  }
  assertNoActiveRuns(row)
}

export function assertWorkflowTemplateArchivable(row: WorkflowTemplateRow): void {
  if (row.scope === 'built-in') {
    throw new WorkflowError('workflow_forbidden', 'Built-in templates cannot be archived.')
  }
  if (row.archived_at) {
    throw new WorkflowError('workflow_archived', 'Template is already archived.')
  }
  assertNoActiveRuns(row)
}

function assertNoActiveRuns(row: WorkflowTemplateRow): void {
  if (row.active_run_count > 0) {
    throw new WorkflowError(
      'workflow_action_forbidden',
      'Workflow templates cannot be changed while one or more runs are active.',
      { activeRunCount: row.active_run_count }
    )
  }
}
