/** P1 run lineage and frozen run-level configuration. */

export type WorkflowRunPromptOverride = {
  firstVisit?: string
  repeatVisit?: string
}

export type WorkflowRunPromptOverrides = Record<string, WorkflowRunPromptOverride>

export type WorkflowRunPolicyOverridesV1 = {
  policyVersion: 'v1-review-rounds'
  maxReviewRoundsByNodeId: Record<string, number>
}

export type WorkflowRunPolicyOverridesV2 = {
  policyVersion: 'v2-route-traversals'
  maxTraversalsByRouteId: Record<string, number>
}

export type WorkflowRunPolicyOverrides = WorkflowRunPolicyOverridesV1 | WorkflowRunPolicyOverridesV2

export type WorkflowRunLineageFields = {
  parentRunId: string | null
  rootRunId: string
  /** Parent max step.round; lineageCycle = base + localRound. */
  lineageCycleBase: number
  rerunReason: string | null
  noAdditionalRequirements: boolean
  policyOverrides: WorkflowRunPolicyOverrides | null
  promptOverrides: WorkflowRunPromptOverrides | null
}

export function emptyWorkflowRunLineage(runId: string): WorkflowRunLineageFields {
  return {
    parentRunId: null,
    rootRunId: runId,
    lineageCycleBase: 0,
    rerunReason: null,
    noAdditionalRequirements: false,
    policyOverrides: null,
    promptOverrides: null
  }
}

export function assertRerunRequirements(params: {
  rerunReason: string | null | undefined
  noAdditionalRequirements: boolean
}): void {
  const reason = params.rerunReason?.trim() ?? ''
  if (params.noAdditionalRequirements === Boolean(reason)) {
    throw new Error(
      'Provide either a non-empty rerun reason or noAdditionalRequirements, not both or neither.'
    )
  }
}

export function parseWorkflowRunPolicyOverrides(value: unknown): WorkflowRunPolicyOverrides | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.policyVersion === 'v1-review-rounds') {
    const map = record.maxReviewRoundsByNodeId
    if (!map || typeof map !== 'object') {
      return null
    }
    const maxReviewRoundsByNodeId: Record<string, number> = {}
    for (const [nodeId, raw] of Object.entries(map as Record<string, unknown>)) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 20) {
        maxReviewRoundsByNodeId[nodeId] = raw
      }
    }
    return { policyVersion: 'v1-review-rounds', maxReviewRoundsByNodeId }
  }
  if (record.policyVersion === 'v2-route-traversals') {
    const map = record.maxTraversalsByRouteId
    if (!map || typeof map !== 'object') {
      return null
    }
    const maxTraversalsByRouteId: Record<string, number> = {}
    for (const [routeId, raw] of Object.entries(map as Record<string, unknown>)) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 50) {
        maxTraversalsByRouteId[routeId] = raw
      }
    }
    return { policyVersion: 'v2-route-traversals', maxTraversalsByRouteId }
  }
  return null
}

export function parseWorkflowRunPromptOverrides(value: unknown): WorkflowRunPromptOverrides | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const result: WorkflowRunPromptOverrides = {}
  for (const [nodeId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const entry = raw as Record<string, unknown>
    const firstVisit = typeof entry.firstVisit === 'string' ? entry.firstVisit : undefined
    const repeatVisit = typeof entry.repeatVisit === 'string' ? entry.repeatVisit : undefined
    if (firstVisit !== undefined || repeatVisit !== undefined) {
      result[nodeId] = { firstVisit, repeatVisit }
    }
  }
  return Object.keys(result).length > 0 ? result : null
}
