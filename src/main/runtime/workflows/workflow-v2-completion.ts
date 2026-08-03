import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  isWorkflowRunSnapshotV2,
  requireWorkflowDefinitionV2
} from '../../../shared/workflow-definition-access'
import { workflowV2StepById } from '../../../shared/workflow-v2-graph'
import type { WorkflowPreparedCompletion } from './workflow-completion-prepare'
import { settleOrchestrationViaInternalWorkerDone } from './workflow-completion-worker-done'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import {
  completeWorkflowV2AgentStep,
  completeWorkflowV2DecisionStep
} from './workflow-v2-run-controller'

export function isWorkflowV2Run(run: WorkflowRunRecord): boolean {
  return isWorkflowRunSnapshotV2(run.templateSnapshot)
}

export async function finishWorkflowV2Step(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion
  callerIdentity: string
}): Promise<string | null> {
  const finalText = extractFinalText(params.prepared)
  if (!finalText.trim()) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'V2 step returned an empty final response.'
    )
  }
  const settlement = settleOrchestrationViaInternalWorkerDone({
    runtime: params.runtime,
    orchestration: params.orchestration,
    run: params.run,
    step: params.step,
    prepared: params.prepared,
    receiptId: `v2:${params.step.id}:${params.step.attempt}`,
    messageDigest: params.prepared.digest
  })
  if (settlement.failureTerminal) {
    throw new WorkflowError(
      'workflow_outcome_conflict',
      'Orchestration already failed for this V2 attempt; success lost the outcome race.'
    )
  }
  if (!settlement.settled) {
    throw new WorkflowError(
      'workflow_delivery_uncertain',
      'Could not settle Orchestration success before V2 workflow write.'
    )
  }
  const definition = requireWorkflowDefinitionV2(params.run.templateSnapshot as never, 'V2 finish')
  const stepDef = workflowV2StepById(definition, params.step.nodeId)
  const db = params.store.persistenceDb
  const surface = {
    db,
    finishEngineStep: (stepRunId: string, envelope: unknown, conclusionMarkdown: string) => {
      db.prepare(
        `UPDATE workflow_step_runs
         SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
             delivery_state = CASE WHEN delivery_state = 'prepared' THEN 'delivered'
               ELSE delivery_state END,
             started_at = COALESCE(started_at, datetime('now')),
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
    },
    insertEvent: params.store.insertEvent.bind(params.store),
    getStep: params.store.getStep.bind(params.store),
    insertStep: params.store.insertStep.bind(params.store)
  }
  const result = params.store.transaction(() => {
    if (stepDef?.kind === 'decision') {
      return completeWorkflowV2DecisionStep({
        store: surface,
        db: params.store.persistenceDb,
        run: params.run,
        step: params.step,
        finalText
      })
    }
    return completeWorkflowV2AgentStep({
      store: surface,
      db: params.store.persistenceDb,
      run: params.run,
      step: params.step,
      finalText
    })
  })
  if (result.terminal || result.waitingHuman || result.nextSteps.length === 0) {
    return null
  }
  return result.nextSteps[0]?.nodeId ?? null
}

function extractFinalText(prepared: WorkflowPreparedCompletion): string {
  const value = prepared.value
  if (value && typeof value === 'object') {
    if (
      'finalConclusionMarkdown' in value &&
      typeof (value as { finalConclusionMarkdown?: unknown }).finalConclusionMarkdown === 'string'
    ) {
      return (value as { finalConclusionMarkdown: string }).finalConclusionMarkdown
    }
    if (
      'conclusionMarkdown' in value &&
      typeof (value as { conclusionMarkdown?: unknown }).conclusionMarkdown === 'string'
    ) {
      return (value as { conclusionMarkdown: string }).conclusionMarkdown
    }
  }
  return ''
}
