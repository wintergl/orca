import type Database from '../../sqlite/sync-database'
import type {
  WorkflowEventRecord,
  WorkflowRunExportFormat,
  WorkflowRunExportResult,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import { exportWorkflowRun } from './workflow-run-export'
import { listWorkflowV2HistoryWithLineage } from './workflow-v2-history-store'

export function exportStoredWorkflowRun(
  db: Database.Database,
  run: WorkflowRunRecord,
  events: WorkflowEventRecord[],
  format: WorkflowRunExportFormat
): WorkflowRunExportResult {
  const history = isWorkflowRunSnapshotV2(run.templateSnapshot)
    ? listWorkflowV2HistoryWithLineage(db, run)
    : []
  return exportWorkflowRun(run, events, format, history)
}
