/** Explicit product gates for workflow capabilities. */

export const WORKFLOW_V2_FEATURE_GATE_KEY = 'workflows.v2.enabled' as const

/** Keep the legacy settings shape readable while treating V2 as the only product workflow model. */
export function isWorkflowV2FeatureEnabled(
  _settings: { [WORKFLOW_V2_FEATURE_GATE_KEY]?: boolean } | null | undefined
): boolean {
  // V2 is the only user-facing workflow model; legacy false overrides are ignored.
  return true
}
