export class WorkflowError extends Error {
  constructor(
    readonly code:
      | 'workflow_not_found'
      | 'workflow_forbidden'
      | 'workflow_name_conflict'
      | 'workflow_version_conflict'
      | 'workflow_definition_invalid'
      | 'workflow_archived'
      | 'workflow_context_mismatch'
      | 'workflow_agent_unavailable'
      | 'workflow_preflight_failed'
      | 'workflow_m2_scope_unsupported'
      | 'workflow_m3_scope_unsupported'
      | 'workflow_delivery_uncertain'
      | 'workflow_completion_incomplete'
      | 'workflow_artifact_unavailable'
      | 'workflow_artifact_drifted'
      | 'workflow_transition_invalid'
      | 'workflow_decision_invalid'
      | 'workflow_offer_conflict'
      | 'workflow_action_forbidden'
      | 'workflow_export_too_large'
      | 'request_mismatch'
      | 'operation_unknown',
    message: string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}
