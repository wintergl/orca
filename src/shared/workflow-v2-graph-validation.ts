import type { WorkflowDefinitionV2 } from './workflow-definition-v2-types'
import { routeTraversalLimit } from './workflow-route-traversal-budget'
import { workflowV2RouteCatalog } from './workflow-v2-route-catalog'

export function validateWorkflowV2Graph(
  definition: WorkflowDefinitionV2,
  maxTraversalsByRouteId: Readonly<Record<string, number>> = {}
): string[] {
  const catalog = workflowV2RouteCatalog(definition)
  const reachable = reachableStepIds(definition, catalog)
  const issues: string[] = []
  if (!definition.steps.some((step) => reachable.has(step.id) && step.kind === 'end')) {
    issues.push('Entry step cannot reach an end step')
  }
  const unbounded = new Map([...reachable].map((stepId) => [stepId, [] as string[]]))
  for (const entry of catalog) {
    if (!reachable.has(entry.sourceStepId)) {
      continue
    }
    const limit = routeTraversalLimit(entry.id, entry.route.maxTraversals, {
      policyVersion: 'v2-route-traversals',
      maxTraversalsByRouteId: { ...maxTraversalsByRouteId }
    })
    if (limit === null) {
      unbounded.get(entry.sourceStepId)?.push(entry.route.targetStepId)
    } else if (!entry.route.onExhaustedStepId) {
      issues.push(`Bounded route ${entry.id} needs an exhausted human/end target`)
    }
  }
  if (containsCycle(unbounded)) {
    issues.push('Reachable route graph contains an unbounded loop')
  }
  return [...new Set(issues)]
}

function reachableStepIds(
  definition: WorkflowDefinitionV2,
  catalog: ReturnType<typeof workflowV2RouteCatalog>
): Set<string> {
  const reachable = new Set<string>()
  const pending = [definition.entryStepId]
  while (pending.length) {
    const stepId = pending.pop()!
    if (reachable.has(stepId)) {
      continue
    }
    reachable.add(stepId)
    for (const route of catalog.filter((entry) => entry.sourceStepId === stepId)) {
      pending.push(route.route.targetStepId)
      if (route.route.onExhaustedStepId) {
        pending.push(route.route.onExhaustedStepId)
      }
    }
  }
  return reachable
}

function containsCycle(adjacency: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true
    }
    if (visited.has(node)) {
      return false
    }
    visiting.add(node)
    if ((adjacency.get(node) ?? []).some(visit)) {
      return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  return [...adjacency.keys()].some(visit)
}
