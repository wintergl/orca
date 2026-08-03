import type { WorkflowRunPolicyOverridesV2 } from './workflow-definition-v2-types'

/** UI: maxTraversals=2 means up to 3 business rounds (initial + 2 returns). */
export function routeTraversalsToDisplayedRounds(maxTraversals: number): number {
  return Math.max(1, maxTraversals + 1)
}

export function displayedRoundsToRouteTraversals(displayedRounds: number): number {
  return Math.max(0, displayedRounds - 1)
}

export function routeTraversalLimit(
  routeId: string,
  routeMaxTraversals: number | undefined,
  overrides: WorkflowRunPolicyOverridesV2 | null | undefined
): number | null {
  const fromOverride = overrides?.maxTraversalsByRouteId[routeId]
  if (typeof fromOverride === 'number') {
    return fromOverride
  }
  if (typeof routeMaxTraversals === 'number') {
    return routeMaxTraversals
  }
  return null
}

export function canTraverseRoute(usedTraversals: number, limit: number | null): boolean {
  if (limit === null) {
    return true
  }
  return usedTraversals < limit
}
