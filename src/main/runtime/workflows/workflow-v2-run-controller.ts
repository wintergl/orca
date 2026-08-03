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
  listWorkflowV2HistoryWithLineage,
  setWorkflowV2RouteTraversalCounts
} from './workflow-v2-history-store'
import { WorkflowError } from './workflow-error'
import type { WorkflowRuntimePersistence } from './workflow-runtime-persistence'
import {
  applyWorkflowV2Advance,
  insertWorkflowV2Steps,
  type WorkflowV2AdvanceResult
} from './workflow-v2-advance'
import {
  collectAgentOutputs,
  composeParallelFinalText,
  visitAssignmentsComplete,
  visitSiblingSteps
} from './workflow-v2-fan-in'

/** Narrow surface shared by WorkflowRuntimeStore and WorkflowStore for V2 graph writes. */
export type WorkflowV2RuntimeSurface = Pick<
  WorkflowRuntimePersistence,
  'db' | 'finishEngineStep' | 'insertEvent' | 'getStep' | 'insertStep'
>

/**
 * Current visit for prompt selection / history: prior successful visits + 1.
 * Prefer lineage history (includes ancestors) so child Runs get repeat-visit correctly.
 */
function visitCount(run: WorkflowRunRecord, stepId: string, db?: Database.Database): number {
  if (db) {
    const priorVisits = listWorkflowV2HistoryWithLineage(db, run).filter(
      (entry) => entry.stepId === stepId
    ).length
    return priorVisits + 1
  }
  const rounds = new Set(
    run.steps
      .filter((step) => step.nodeId === stepId && step.status === 'succeeded')
      .map((step) => step.round)
  )
  return rounds.size + 1
}

function lineageCycle(run: WorkflowRunRecord, localRound: number): number {
  return (run.lineageCycleBase ?? 0) + localRound
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
  if (!sealStep(params.store, params.step, params.finalText, 'agent')) {
    return idleAdvanceResult()
  }
  const siblings = visitSiblingSteps(params.store, params.run, params.step)
  if (!visitAssignmentsComplete(params.run, params.step, siblings)) {
    return idleAdvanceResult()
  }
  const agentOutputs = collectAgentOutputs(siblings)
  const finalText = composeParallelFinalText(agentOutputs)
  appendWorkflowV2History(params.db, params.run.id, {
    stepId: params.step.nodeId,
    stepName: params.step.nodeName,
    stepKind: 'agent',
    visit: visitCount(params.run, params.step.nodeId, params.db),
    cycle: lineageCycle(params.run, params.step.round),
    attempt: params.step.attempt,
    promptText: params.step.prompt || null,
    finalText,
    agentOutputs,
    decision: null
  })
  const counts = getWorkflowV2RouteTraversalCounts(params.db, params.run.id)
  const advance = resolveWorkflowV2AgentNext(
    definition,
    params.step.nodeId,
    counts,
    v2PolicyOverrides(params.run)
  )
  claimRouteTraversal(params.db, params.run.id, advance.kind === 'goto' ? advance.routeId : null)
  return applyWorkflowV2Advance(params.store, params.run, definition, advance, params.step.round)
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
  if (!sealStep(params.store, params.step, params.finalText, 'decision')) {
    return idleAdvanceResult()
  }
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
    visit: visitCount(params.run, params.step.nodeId, params.db),
    cycle: lineageCycle(params.run, params.step.round),
    attempt: params.step.attempt,
    promptText: params.step.prompt || null,
    finalText: params.finalText,
    agentOutputs: [],
    decision
  })
  claimRouteTraversal(params.db, params.run.id, advance.kind === 'goto' ? advance.routeId : null)
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
  const counts = getWorkflowV2RouteTraversalCounts(params.db, params.run.id)
  const advance = resolveWorkflowV2Human(
    definition,
    params.stepId,
    params.routeId,
    counts,
    v2PolicyOverrides(params.run)
  )
  appendWorkflowV2History(params.db, params.run.id, {
    stepId: params.stepId,
    stepName: workflowV2StepById(definition, params.stepId)?.name ?? params.stepId,
    stepKind: 'human',
    visit: visitCount(params.run, params.stepId, params.db),
    cycle: lineageCycle(params.run, Math.max(1, ...params.run.steps.map((s) => s.round), 1)),
    attempt: 1,
    promptText: null,
    finalText: params.humanText?.trim() || params.routeId,
    agentOutputs: [],
    decision: null
  })
  claimRouteTraversal(params.db, params.run.id, advance.kind === 'goto' ? advance.routeId : null)
  return applyWorkflowV2Advance(
    params.store,
    params.run,
    definition,
    advance,
    Math.max(1, ...params.run.steps.map((step) => step.round), 1)
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
    visit: visitCount(run, step.nodeId, db),
    cycle: lineageCycle(run, step.round),
    history: listWorkflowV2HistoryWithLineage(db, run)
  })
}

/** Returns true when this call newly sealed the step. */
function sealStep(
  store: WorkflowV2RuntimeSurface,
  step: WorkflowStepRunRecord,
  finalText: string,
  kind: 'agent' | 'decision'
): boolean {
  const result = store.db
    .prepare(
      `UPDATE workflow_step_runs
       SET status = 'succeeded', conclusion_markdown = ?, result_envelope_json = ?,
           delivery_state = CASE WHEN delivery_state = 'prepared' THEN 'delivered'
             ELSE delivery_state END,
           started_at = COALESCE(started_at, datetime('now')),
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')`
    )
    .run(finalText, JSON.stringify({ finalText }), step.id)
  if (result.changes !== 1) {
    return false
  }
  store.insertEvent(step.runId, 'step-completed', step.id, {
    nodeId: step.nodeId,
    schemaVersion: 2,
    kind
  })
  return true
}

function claimRouteTraversal(
  db: Database.Database,
  runId: string,
  routeId: string | null | undefined
): void {
  if (!routeId) {
    return
  }
  const counts = getWorkflowV2RouteTraversalCounts(db, runId)
  counts[routeId] = (counts[routeId] ?? 0) + 1
  setWorkflowV2RouteTraversalCounts(db, runId, counts)
}

function idleAdvanceResult(): WorkflowV2AdvanceResult {
  return { nextSteps: [], terminal: false, waitingHuman: false }
}
