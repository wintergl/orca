/** Explicit product gates for workflow capabilities. */

export const WORKFLOW_V2_FEATURE_GATE_KEY = 'workflows.v2.enabled' as const

/** Each runtime host keeps an explicit override so remote capabilities stay independently gated. */
export function isWorkflowV2FeatureEnabled(
  settings: { [WORKFLOW_V2_FEATURE_GATE_KEY]?: boolean } | null | undefined
): boolean {
  return settings?.[WORKFLOW_V2_FEATURE_GATE_KEY] === true
}
