import type {
  WorkflowDefinitionV2,
  WorkflowHistoryEntryV2,
  WorkflowRouteV2,
  WorkflowStepDefinitionV2
} from './workflow-definition-v2-types'
import { parseWorkflowBinaryDecision } from './workflow-binary-decision-protocol'
import { canTraverseRoute, routeTraversalLimit } from './workflow-route-traversal-budget'
import type { WorkflowRunPolicyOverridesV2 } from './workflow-definition-v2-types'

export type WorkflowV2GraphAdvance =
  | { kind: 'goto'; stepId: string; routeId: string | null }
  | { kind: 'end'; outcome: 'succeeded' | 'cancelled' | 'failed' }
  | { kind: 'wait-human'; stepId: string }
  | { kind: 'retry-decision'; reason: string }

export function workflowV2StepById(
  definition: WorkflowDefinitionV2,
  stepId: string
): WorkflowStepDefinitionV2 | null {
  return definition.steps.find((step) => step.id === stepId) ?? null
}

export function resolveWorkflowV2AgentNext(
  definition: WorkflowDefinitionV2,
  stepId: string
): WorkflowV2GraphAdvance {
  const step = workflowV2StepById(definition, stepId)
  if (step?.kind !== 'agent') {
    throw new Error(`Step ${stepId} is not an agent step.`)
  }
  return resolveRoute(definition, step.next, `agent:${stepId}:next`, null, null)
}

export function resolveWorkflowV2Decision(
  definition: WorkflowDefinitionV2,
  stepId: string,
  finalText: string,
  usedTraversalsByRouteId: Record<string, number>,
  policyOverrides?: WorkflowRunPolicyOverridesV2 | null
): WorkflowV2GraphAdvance {
  const step = workflowV2StepById(definition, stepId)
  if (step?.kind !== 'decision') {
    throw new Error(`Step ${stepId} is not a decision step.`)
  }
  let decision: boolean
  try {
    decision = parseWorkflowBinaryDecision(finalText)
  } catch {
    return resolveRoute(
      definition,
      step.routes.whenInvalid,
      `decision:${stepId}:invalid`,
      null,
      null
    )
  }
  const route = decision ? step.routes.whenTrue : step.routes.whenFalse
  const routeId = decision ? `decision:${stepId}:true` : `decision:${stepId}:false`
  return resolveRoute(definition, route, routeId, usedTraversalsByRouteId, policyOverrides)
}

export function resolveWorkflowV2Human(
  definition: WorkflowDefinitionV2,
  stepId: string,
  routeId: string
): WorkflowV2GraphAdvance {
  const step = workflowV2StepById(definition, stepId)
  if (step?.kind !== 'human') {
    throw new Error(`Step ${stepId} is not a human step.`)
  }
  const route = step.routes.find((candidate) => candidate.id === routeId)
  if (!route) {
    throw new Error(`Human route ${routeId} is unavailable.`)
  }
  return resolveRoute(
    definition,
    { targetStepId: route.targetStepId },
    `human:${stepId}:${routeId}`,
    null,
    null
  )
}

export function buildWorkflowV2RoundHistory(
  entries: readonly WorkflowHistoryEntryV2[]
): Record<number, { nodes: Record<string, { output: string }> }> {
  const history: Record<number, { nodes: Record<string, { output: string }> }> = {}
  for (const entry of entries) {
    const round = history[entry.cycle] ?? { nodes: {} }
    round.nodes[entry.stepId] = { output: entry.finalText }
    history[entry.cycle] = round
  }
  return history
}

function resolveRoute(
  definition: WorkflowDefinitionV2,
  route: WorkflowRouteV2,
  routeId: string,
  usedTraversalsByRouteId: Record<string, number> | null,
  policyOverrides: WorkflowRunPolicyOverridesV2 | null | undefined
): WorkflowV2GraphAdvance {
  const target = workflowV2StepById(definition, route.targetStepId)
  if (!target) {
    throw new Error(`Route target ${route.targetStepId} is missing.`)
  }
  if (usedTraversalsByRouteId) {
    const limit = routeTraversalLimit(routeId, route.maxTraversals, policyOverrides)
    const used = usedTraversalsByRouteId[routeId] ?? 0
    if (!canTraverseRoute(used, limit)) {
      if (route.onExhaustedStepId) {
        const exhausted = workflowV2StepById(definition, route.onExhaustedStepId)
        if (!exhausted) {
          throw new Error(`Exhausted route target ${route.onExhaustedStepId} is missing.`)
        }
        if (exhausted.kind === 'end') {
          return { kind: 'end', outcome: exhausted.outcome }
        }
        if (exhausted.kind === 'human') {
          return { kind: 'wait-human', stepId: exhausted.id }
        }
        return { kind: 'goto', stepId: exhausted.id, routeId: `${routeId}:exhausted` }
      }
      return { kind: 'wait-human', stepId: route.targetStepId }
    }
  }
  if (target.kind === 'end') {
    return { kind: 'end', outcome: target.outcome }
  }
  if (target.kind === 'human') {
    return { kind: 'wait-human', stepId: target.id }
  }
  return { kind: 'goto', stepId: target.id, routeId }
}
