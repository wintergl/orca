import type Database from '../../sqlite/sync-database'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowRunPolicyOverridesV2 } from '../../../shared/workflow-definition-v2-types'
import { requireWorkflowDefinitionV2 } from '../../../shared/workflow-definition-access'
import { parseWorkflowBinaryDecision } from '../../../shared/workflow-binary-decision-protocol'
import {
  resolveWorkflowV2AgentNext,
  resolveWorkflowV2Decision,
  resolveWorkflowV2Human,
  workflowV2StepById
} from '../../../shared/workflow-v2-graph'
import { renderWorkflowV2StepPrompt } from './workflow-v2-prompt'
import {
  appendWorkflowV2History,
  getWorkflowV2RouteTraversalCounts,
  listWorkflowV2History,
  setWorkflowV2RouteTraversalCounts
} from './workflow-v2-history-store'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import {
  applyWorkflowV2Advance,
  insertWorkflowV2Steps,
  type WorkflowV2AdvanceResult
} from './workflow-v2-advance'

/** Narrow surface shared by WorkflowRuntimeStore and WorkflowStore for V2 graph writes. */
export type WorkflowV2RuntimeSurface = Pick<
  WorkflowRuntimePersistence,
  'db' | 'finishEngineStep' | 'insertEvent' | 'getStep' | 'insertStep'
>

function visitCount(run: WorkflowRunRecord, stepId: string): number {
  return (
    run.steps.filter((step) => step.nodeId === stepId && step.status === 'succeeded').length + 1
  )
}

function cycleForRun(run: WorkflowRunRecord): number {
  const local = Math.max(1, ...run.steps.map((step) => step.round), 1)
  return (run.lineageCycleBase ?? 0) + local
}

function v2PolicyOverrides(run: WorkflowRunRecord): WorkflowRunPolicyOverridesV2 | null {
  const value = run.policyOverrides as unknown
  if (
    value &&
    typeof value === 'object' &&
    (value as { policyVersion?: unknown }).policyVersion === 'v2-route-traversals' &&
    typeof (value as WorkflowRunPolicyOverridesV2).maxTraversalsByRouteId === 'object'
  ) {
    return value as WorkflowRunPolicyOverridesV2
  }
  return null
}

export function beginWorkflowV2Run(
  store: WorkflowV2RuntimeSurface,
  run: WorkflowRunRecord,
  baseline: unknown
): WorkflowStepRunRecord[] {
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot as never, 'V2 begin')
  const entry = workflowV2StepById(definition, definition.entryStepId)
  if (!entry || (entry.kind !== 'agent' && entry.kind !== 'decision')) {
    throw new WorkflowError(
      'workflow_transition_invalid',
      'V2 entry step must be agent or decision.'
    )
  }
  const steps = insertWorkflowV2Steps(store, run, definition, entry.id, 1)
  store.db
    .prepare(
      `UPDATE workflow_runs
       SET status = 'running', current_node_id = ?, baseline_json = ?,
           failure_code = NULL, failure_message = NULL, recovery = NULL,
           started_at = datetime('now'), completed_at = NULL,
           version = version + 1, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(entry.id, JSON.stringify(baseline ?? {}), run.id)
  if (steps[0]) {
    store.insertEvent(run.id, 'run-started', steps[0].id, {
      nodeId: entry.id,
      schemaVersion: 2
    })
  }
  return steps
}

export function completeWorkflowV2AgentStep(params: {
  store: WorkflowV2RuntimeSurface
  db: Database.Database
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  finalText: string
}): WorkflowV2AdvanceResult {
  const definition = requireWorkflowDefinitionV2(params.run.templateSnapshot as never, 'V2 agent')
  const stepDef = workflowV2StepById(definition, params.step.nodeId)
  if (stepDef?.kind !== 'agent') {
    throw new WorkflowError('workflow_transition_invalid', 'Step is not a V2 agent step.')
  }
  sealStep(params.store, params.step, params.finalText, 'agent')
  appendWorkflowV2History(params.db, params.run.id, {
    stepId: params.step.nodeId,
    stepName: params.step.nodeName,
    stepKind: 'agent',
    visit: visitCount(params.run, params.step.nodeId),
    cycle: params.step.round,
    attempt: params.step.attempt,
    promptText: params.step.prompt || null,
    finalText: params.finalText,
    agentOutputs: params.step.assignment
      ? [
          {
            slotId: params.step.assignment.slotId,
            agentIdentity: params.step.assignment.agentLifecycleId,
            finalText: params.finalText
          }
        ]
      : [],
    decision: null
  })
  return applyWorkflowV2Advance(
    params.store,
    params.run,
    definition,
    resolveWorkflowV2AgentNext(definition, params.step.nodeId),
    params.step.round
  )
}

export function completeWorkflowV2DecisionStep(params: {
  store: WorkflowV2RuntimeSurface
  db: Database.Database
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  finalText: string
}): WorkflowV2AdvanceResult {
  const definition = requireWorkflowDefinitionV2(
    params.run.templateSnapshot as never,
    'V2 decision'
  )
  sealStep(params.store, params.step, params.finalText, 'decision')
  const counts = getWorkflowV2RouteTraversalCounts(params.db, params.run.id)
  const advance = resolveWorkflowV2Decision(
    definition,
    params.step.nodeId,
    params.finalText,
    counts,
    v2PolicyOverrides(params.run)
  )
  let decision: boolean | null = null
  try {
    decision = parseWorkflowBinaryDecision(params.finalText)
  } catch {
    decision = null
  }
  appendWorkflowV2History(params.db, params.run.id, {
    stepId: params.step.nodeId,
    stepName: params.step.nodeName,
    stepKind: 'decision',
    visit: visitCount(params.run, params.step.nodeId),
    cycle: params.step.round,
    attempt: params.step.attempt,
    promptText: params.step.prompt || null,
    finalText: params.finalText,
    agentOutputs: [],
    decision
  })
  if (advance.kind === 'goto' && advance.routeId?.endsWith(':false')) {
    counts[advance.routeId] = (counts[advance.routeId] ?? 0) + 1
    setWorkflowV2RouteTraversalCounts(params.db, params.run.id, counts)
  }
  return applyWorkflowV2Advance(params.store, params.run, definition, advance, params.step.round)
}

export function resolveWorkflowV2HumanAction(params: {
  store: WorkflowV2RuntimeSurface
  db: Database.Database
  run: WorkflowRunRecord
  stepId: string
  routeId: string
  humanText?: string
}): WorkflowV2AdvanceResult {
  const definition = requireWorkflowDefinitionV2(params.run.templateSnapshot as never, 'V2 human')
  appendWorkflowV2History(params.db, params.run.id, {
    stepId: params.stepId,
    stepName: workflowV2StepById(definition, params.stepId)?.name ?? params.stepId,
    stepKind: 'human',
    visit: visitCount(params.run, params.stepId),
    cycle: cycleForRun(params.run),
    attempt: 1,
    promptText: null,
    finalText: params.humanText?.trim() || params.routeId,
    agentOutputs: [],
    decision: null
  })
  return applyWorkflowV2Advance(
    params.store,
    params.run,
    definition,
    resolveWorkflowV2Human(definition, params.stepId, params.routeId),
    cycleForRun(params.run)
  )
}

export function buildWorkflowV2StepPrompt(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  db: Database.Database
): string {
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot as never, 'V2 prompt')
  return renderWorkflowV2StepPrompt({
    definition,
    stepId: step.nodeId,
    goal: run.objective,
    workflowName: `${run.templateName} v${run.templateVersion}`,
    visit: visitCount(run, step.nodeId),
    cycle: step.round,
    history: listWorkflowV2History(db, run.id)
  })
}

function sealStep(
  store: WorkflowV2RuntimeSurface,
  step: WorkflowStepRunRecord,
  finalText: string,
  kind: 'agent' | 'decision'
): void {
  if (store.getStep(step.id)?.status === 'succeeded') {
    return
  }
  store.finishEngineStep(step.id, { finalText }, finalText)
  store.insertEvent(step.runId, 'step-completed', step.id, {
    nodeId: step.nodeId,
    schemaVersion: 2,
    kind
  })
}
