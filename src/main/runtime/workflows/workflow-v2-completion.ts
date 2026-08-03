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
import { reconcileWorkflowStepSuccess } from './workflow-completion-success-reconciler'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'
import {
  completeWorkflowV2AgentStep,
  completeWorkflowV2DecisionStep,
  type WorkflowV2RuntimeSurface
} from './workflow-v2-run-controller'

export function isWorkflowV2Run(run: WorkflowRunRecord): boolean {
  return isWorkflowRunSnapshotV2(run.templateSnapshot)
}

/**
 * V2 success path: same durable receive → orch settle → workflow settle machine as V1.
 * Business write is applied inside applyWorkflowSuccessWriteAtomic via applyV2ProduceSuccess.
 */
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
  void params.callerIdentity
  const result = await reconcileWorkflowStepSuccess({
    store: params.store,
    orchestration: params.orchestration,
    runtime: params.runtime,
    run: params.run,
    step: params.step,
    prepared: params.prepared
  })
  if (result.conflict) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'V2 success lost the attempt outcome race.'
    )
  }
  return result.nextNodeId
}

export function workflowV2RuntimeSurface(store: WorkflowStore): WorkflowV2RuntimeSurface {
  return {
    db: store.persistenceDb,
    finishEngineStep: (stepRunId, envelope, conclusionMarkdown) => {
      store.persistenceDb
        .prepare(
          `UPDATE workflow_step_runs
           SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
               delivery_state = CASE WHEN delivery_state = 'prepared' THEN 'delivered'
                 ELSE delivery_state END,
               started_at = COALESCE(started_at, datetime('now')),
               completed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(conclusionMarkdown, JSON.stringify(envelope), stepRunId)
    },
    insertEvent: store.insertEvent.bind(store),
    getStep: store.getStep.bind(store),
    insertStep: store.insertStep.bind(store)
  }
}

/** Called from produce success write when the Run is V2. Must run inside a Workflow transaction. */
export function applyV2ProduceSuccessInTransaction(
  store: WorkflowStore,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  finalText: string
): string | null {
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot as never, 'V2 produce write')
  const stepDef = workflowV2StepById(definition, step.nodeId)
  const surface = workflowV2RuntimeSurface(store)
  const result =
    stepDef?.kind === 'decision'
      ? completeWorkflowV2DecisionStep({
          store: surface,
          db: store.persistenceDb,
          run,
          step,
          finalText
        })
      : completeWorkflowV2AgentStep({
          store: surface,
          db: store.persistenceDb,
          run,
          step,
          finalText
        })
  if (result.terminal || result.waitingHuman || result.nextSteps.length === 0) {
    return null
  }
  return result.nextSteps[0]?.nodeId ?? null
}

export function extractFinalText(prepared: WorkflowPreparedCompletion): string {
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
