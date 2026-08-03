import type { WorkflowRunStatus } from '../../../../shared/workflow-definition-types'

export type WorkflowHistoryPreferences = {
  scope: 'workspace' | 'project'
  status: 'all' | WorkflowRunStatus
  templateId: string
  createdFrom: string
  createdTo: string
  query: string
}

const STORAGE_KEY = 'orca.workflow-history.preferences.v1'

export const DEFAULT_WORKFLOW_HISTORY_PREFERENCES: WorkflowHistoryPreferences = {
  scope: 'project',
  status: 'all',
  templateId: 'all',
  createdFrom: '',
  createdTo: '',
  query: ''
}

export function readWorkflowHistoryPreferences(): WorkflowHistoryPreferences {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (!value) {
      return DEFAULT_WORKFLOW_HISTORY_PREFERENCES
    }
    const parsed = JSON.parse(value) as Partial<WorkflowHistoryPreferences>
    return {
      scope: parsed.scope === 'workspace' ? 'workspace' : 'project',
      status: typeof parsed.status === 'string' ? parsed.status : 'all',
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : 'all',
      createdFrom: dateValue(parsed.createdFrom),
      createdTo: dateValue(parsed.createdTo),
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, 500) : ''
    } as WorkflowHistoryPreferences
  } catch {
    return DEFAULT_WORKFLOW_HISTORY_PREFERENCES
  }
}

export function writeWorkflowHistoryPreferences(value: WorkflowHistoryPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage may be disabled; history remains usable for this session.
  }
}

function dateValue(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}
