import type Database from '../../sqlite/sync-database'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import { buildWorkflowResolutionOffers } from './workflow-resolution-offers'
import type { WorkflowRuntimeStore } from './workflow-runtime-store'
import {
  getWorkflowV2RouteBudgetExtensions,
  getWorkflowV2RouteTraversalCounts,
  listWorkflowV2HistoryWithLineage
} from './workflow-v2-history-store'

export function hydrateWorkflowRunDetail(
  db: Database.Database,
  runtime: WorkflowRuntimeStore,
  run: WorkflowRunRecord
): WorkflowRunRecord {
  const complete = {
    ...run,
    steps: runtime.listSteps(run.id),
    artifacts: runtime.listArtifacts(run.id),
    reviewAggregates: runtime.listReviewAggregates(run.id),
    decisions: runtime.listDecisions(run.id),
    v2History: isWorkflowRunSnapshotV2(run.templateSnapshot)
      ? listWorkflowV2HistoryWithLineage(db, run)
      : [],
    v2RouteTraversals: isWorkflowRunSnapshotV2(run.templateSnapshot)
      ? getWorkflowV2RouteTraversalCounts(db, run.id)
      : {},
    v2RouteBudgetExtensions: isWorkflowRunSnapshotV2(run.templateSnapshot)
      ? getWorkflowV2RouteBudgetExtensions(db, run.id)
      : {}
  }
  return { ...complete, resolutionOffers: buildWorkflowResolutionOffers(complete) }
}
