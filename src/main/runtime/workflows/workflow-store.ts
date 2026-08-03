import Database from '../../sqlite/sync-database'
import type {
  WorkflowPreflightResult,
  WorkflowArtifactRevision,
  WorkflowRunEventsResult,
  WorkflowRunExportFormat,
  WorkflowRunExportResult,
  WorkflowRunHistoryFilter,
  WorkflowRunRecord,
  WorkflowRunSummary,
  WorkflowReviewAggregate,
  WorkflowStepRunRecord,
  WorkflowTemplateRecord
} from '../../../shared/workflow-definition-types'
import { createWorkflowTables } from './workflow-database-schema'
import { seedBuiltinWorkflowTemplates } from './workflow-database-seed'
import { WorkflowRunStore } from './workflow-run-store'
import { WorkflowRuntimeStore } from './workflow-runtime-store'
import { WorkflowTemplateStore } from './workflow-template-store'
import { hardenWorkflowDatabaseFiles } from './workflow-database-permissions'
import { bindWorkflowStepDispatchIdentity } from './workflow-delivery-store'
import { failWorkflowRunInTransaction } from './workflow-runtime-terminal-transitions'
import { exportStoredWorkflowRun } from './workflow-run-export-facade'
import { updateWorkflowRunObjective } from './workflow-run-objective-update'
import { recordWorkflowLateCompletionIgnored } from './workflow-late-completion-event'
import { hydrateWorkflowRunDetail } from './workflow-run-detail-hydration'

export class WorkflowStore {
  private readonly db: Database.Database
  private readonly templates: WorkflowTemplateStore
  private readonly runs: WorkflowRunStore
  private readonly runtime: WorkflowRuntimeStore

  constructor(path: string | ':memory:') {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    createWorkflowTables(this.db)
    seedBuiltinWorkflowTemplates(this.db)
    this.templates = new WorkflowTemplateStore(this.db)
    this.runs = new WorkflowRunStore(this.db, this.templates)
    this.runtime = new WorkflowRuntimeStore(this.db, (runId, callerIdentity) =>
      this.showRun(runId, callerIdentity)
    )
    hardenWorkflowDatabaseFiles(path)
  }

  close(): void {
    this.db.close()
  }

  /** Exposed for durable completion reconciliation / ownership CAS. */
  get persistenceDb(): Database.Database {
    return this.db
  }

  transaction<T>(operation: () => T): T {
    return this.runtime.transaction(operation)
  }

  bindStepDispatchIdentity(params: {
    runId: string
    stepRunId: string
    taskId: string
    dispatchId: string
  }): void {
    bindWorkflowStepDispatchIdentity(this.runtime, params)
  }

  listTemplates(...params: Parameters<WorkflowTemplateStore['list']>): WorkflowTemplateRecord[] {
    return this.templates.list(...params)
  }

  showTemplate(...params: Parameters<WorkflowTemplateStore['show']>): WorkflowTemplateRecord {
    return this.templates.show(...params)
  }

  createTemplate(...params: Parameters<WorkflowTemplateStore['create']>): WorkflowTemplateRecord {
    return this.templates.create(...params)
  }

  updateTemplate(...params: Parameters<WorkflowTemplateStore['update']>): WorkflowTemplateRecord {
    return this.templates.update(...params)
  }

  cloneTemplate(...params: Parameters<WorkflowTemplateStore['clone']>): WorkflowTemplateRecord {
    return this.templates.clone(...params)
  }

  archiveTemplate(...params: Parameters<WorkflowTemplateStore['archive']>): WorkflowTemplateRecord {
    return this.templates.archive(...params)
  }

  createRun(...params: Parameters<WorkflowRunStore['create']>): WorkflowRunRecord {
    return this.runs.create(...params)
  }

  createRunRerun(...params: Parameters<WorkflowRunStore['createRerun']>): WorkflowRunRecord {
    return this.runs.createRerun(...params)
  }

  showRun(runId: string, callerIdentity: string): WorkflowRunRecord {
    const run = this.runs.show(runId, callerIdentity)
    return hydrateWorkflowRunDetail(this.persistenceDb, this.runtime, run)
  }

  getArtifact(artifactId: string): WorkflowArtifactRevision | null {
    return this.runtime.getArtifact(artifactId)
  }

  listRuns(filter: WorkflowRunHistoryFilter, callerIdentity: string): WorkflowRunSummary[] {
    return this.runs.list(filter, callerIdentity)
  }

  exportRun(
    runId: string,
    format: WorkflowRunExportFormat,
    callerIdentity: string
  ): WorkflowRunExportResult {
    const run = this.showRun(runId, callerIdentity)
    return exportStoredWorkflowRun(
      this.persistenceDb,
      run,
      this.runtime.events(runId).events,
      format
    )
  }

  updateRunConfiguration(
    ...params: Parameters<WorkflowRunStore['updateConfiguration']>
  ): WorkflowRunRecord {
    return this.runs.updateConfiguration(...params)
  }

  updateRunObjective(
    params: { runId: string; objective: string },
    mutation: Parameters<WorkflowRunStore['updateConfiguration']>[1]
  ): WorkflowRunRecord {
    return updateWorkflowRunObjective(this.runs, params, mutation)
  }

  switchRunTemplate(...params: Parameters<WorkflowRunStore['switchTemplate']>): WorkflowRunRecord {
    return this.runs.switchTemplate(...params)
  }

  assignAgent(...params: Parameters<WorkflowRunStore['assign']>): WorkflowRunRecord {
    return this.runs.assign(...params)
  }

  prepareRun(...params: Parameters<WorkflowRunStore['prepare']>): WorkflowPreflightResult {
    return this.runs.prepare(...params)
  }

  beginRun(...params: Parameters<WorkflowRuntimeStore['beginRun']>): WorkflowRunRecord {
    return this.runtime.beginRun(...params)
  }

  pauseRun(...params: Parameters<WorkflowRuntimeStore['pauseRun']>): WorkflowRunRecord {
    return this.runtime.pauseRun(...params)
  }

  resumeRun(...params: Parameters<WorkflowRuntimeStore['resumeRun']>): WorkflowRunRecord {
    return this.runtime.resumeRun(...params)
  }

  cancelRun(...params: Parameters<WorkflowRuntimeStore['cancelRun']>): WorkflowRunRecord {
    return this.runtime.cancelRun(...params)
  }

  resolveRun(...params: Parameters<WorkflowRuntimeStore['resolveRun']>): WorkflowRunRecord {
    return this.runtime.resolveRun(...params)
  }

  retryStep(...params: Parameters<WorkflowRuntimeStore['retryStep']>): WorkflowRunRecord {
    return this.runtime.retryStep(...params)
  }

  reassignStep(...params: Parameters<WorkflowRuntimeStore['reassignStep']>): WorkflowRunRecord {
    return this.runtime.reassignStep(...params)
  }

  setOrchestrationRun(runId: string, orchestrationRunId: string): void {
    this.runtime.setOrchestrationRun(runId, orchestrationRunId)
  }

  markStepDelivering(...params: Parameters<WorkflowRuntimeStore['markDelivering']>): void {
    this.runtime.markDelivering(...params)
  }

  markStepDelivered(...params: Parameters<WorkflowRuntimeStore['markDelivered']>): void {
    this.runtime.markDelivered(...params)
  }

  markStepWorking(...params: Parameters<WorkflowRuntimeStore['markWorking']>): void {
    this.runtime.markWorking(...params)
  }

  markStepRunning(...params: Parameters<WorkflowRuntimeStore['markRunning']>): void {
    this.runtime.markRunning(...params)
  }

  findActiveRunOwnerByDispatch(
    ...params: Parameters<WorkflowRuntimeStore['findActiveRunOwnerByDispatch']>
  ) {
    return this.runtime.findActiveRunOwnerByDispatch(...params)
  }

  listRecoverableRunOwners(): { runId: string; ownerIdentity: string }[] {
    return this.runtime.listRecoverableRunOwners()
  }

  acquireRecoveryLease(runId: string, ownerId: string): boolean {
    return this.runtime.acquireRecoveryLease(runId, ownerId)
  }

  markRecoveryWaiting(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    reason: 'delivery-uncertain' | 'lifecycle-mismatch' | 'transport-disconnected',
    message: string
  ): void {
    this.runtime.markRecoveryWaiting(run, step, reason, message)
  }

  recordRunRecovered(runId: string, stepRunId: string | null, payload: unknown): void {
    this.runtime.recordRunRecovered(runId, stepRunId, payload)
  }

  completeProduce(
    params: Parameters<WorkflowRuntimeStore['completeProduce']>[0]
  ): WorkflowStepRunRecord[] {
    return this.runtime.completeProduce(params)
  }

  completeProduceInTransaction(
    params: Parameters<WorkflowRuntimeStore['completeProduceInTransaction']>[0]
  ): WorkflowStepRunRecord[] {
    return this.runtime.completeProduceInTransaction(params)
  }

  completeReview(
    params: Parameters<WorkflowRuntimeStore['completeReview']>[0]
  ): WorkflowReviewAggregate | null {
    return this.runtime.completeReview(params)
  }

  completeReviewInTransaction(
    params: Parameters<WorkflowRuntimeStore['completeReviewInTransaction']>[0]
  ): WorkflowReviewAggregate | null {
    return this.runtime.completeReviewInTransaction(params)
  }

  advanceProduce(
    run: WorkflowRunRecord,
    step: WorkflowStepRunRecord,
    artifact: WorkflowArtifactRevision
  ): WorkflowStepRunRecord[] {
    return this.runtime.advanceProduce(run, step, artifact)
  }

  advanceAggregate(
    run: WorkflowRunRecord,
    aggregate: WorkflowReviewAggregate
  ): WorkflowStepRunRecord | null {
    return this.runtime.advanceAggregate(run, aggregate)
  }

  completeDecision(...params: Parameters<WorkflowRuntimeStore['completeDecision']>): void {
    this.runtime.completeDecision(...params)
  }

  completeDecisionInTransaction(
    ...params: Parameters<WorkflowRuntimeStore['completeDecisionInTransaction']>
  ): void {
    this.runtime.completeDecisionInTransaction(...params)
  }

  advancePersistedDecision(
    ...params: Parameters<WorkflowRuntimeStore['advancePersistedDecision']>
  ): void {
    this.runtime.advancePersistedDecision(...params)
  }

  failReviewer(
    params: Parameters<WorkflowRuntimeStore['failReviewer']>[0]
  ): WorkflowStepRunRecord | null {
    return this.runtime.failReviewer(params)
  }

  failDecision(
    params: Parameters<WorkflowRuntimeStore['failDecision']>[0]
  ): WorkflowStepRunRecord | null {
    return this.runtime.failDecision(params)
  }

  failRunInTransaction(params: Parameters<typeof failWorkflowRunInTransaction>[1]): void {
    failWorkflowRunInTransaction(this.runtime, params)
  }

  failRun(params: Parameters<WorkflowRuntimeStore['fail']>[0]): void {
    this.runtime.fail(params)
  }

  markArtifactDrifted(runId: string, stepRunId: string, artifactRevisionId: string): void {
    this.runtime.markArtifactDrifted(runId, stepRunId, artifactRevisionId)
  }

  saveArtifact(
    ...params: Parameters<WorkflowRuntimeStore['saveArtifact']>
  ): WorkflowArtifactRevision {
    return this.runtime.saveArtifact(...params)
  }

  putBlob(content: Buffer): { blobId: string; digest: string; size: number } {
    return this.runtime.putBlob(content)
  }

  getBlob(blobId: string): Buffer | null {
    return this.runtime.getBlob(blobId)
  }

  getBaseline(runId: string): unknown {
    return this.runtime.getBaseline(runId)
  }

  getStep(stepRunId: string) {
    return this.runtime.getStep(stepRunId)
  }

  insertStep(...params: Parameters<WorkflowRuntimeStore['insertStep']>): WorkflowStepRunRecord {
    return this.runtime.insertStep(...params)
  }

  insertEvent(
    runId: string,
    type: Parameters<WorkflowRuntimeStore['insertEvent']>[1],
    stepRunId: string | null,
    payload: unknown
  ): void {
    this.runtime.insertEvent(runId, type, stepRunId, payload)
  }

  getStepReviewGuardDigest(stepRunId: string): string | null {
    return this.runtime.getStepReviewGuardDigest(stepRunId)
  }

  runEvents(runId: string): WorkflowRunEventsResult {
    return this.runtime.events(runId)
  }

  recordLateCompletionIgnored(
    runId: string,
    stepRunId: string,
    payload: Record<string, unknown>
  ): void {
    recordWorkflowLateCompletionIgnored(this.runtime, runId, stepRunId, payload)
  }
}
