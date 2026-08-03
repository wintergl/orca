/** Explicit product gates for workflow capabilities. */

export const WORKFLOW_V2_FEATURE_GATE_KEY = 'workflows.v2.enabled' as const

/** Default off until install-package matrix and three-template E2E land. */
export function isWorkflowV2FeatureEnabled(
  settings: { [WORKFLOW_V2_FEATURE_GATE_KEY]?: boolean } | null | undefined
): boolean {
  return settings?.[WORKFLOW_V2_FEATURE_GATE_KEY] === true
}
