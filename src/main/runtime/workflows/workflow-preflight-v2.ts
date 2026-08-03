import type {
  WorkflowPreflightCheck,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import {
  workflowAssignableUnits,
  workflowRoleSlots
} from '../../../shared/workflow-definition-access'
import { WORKFLOW_DECISION_PROTOCOL_VERSION_V2 } from '../../../shared/workflow-decision-protocol'
import { isWorkflowDefinitionV2 } from '../../../shared/workflow-definition-v2-schema'
import {
  workflowAgentUnavailableReasonLabel,
  type WorkflowAgentUnavailableReason
} from './workflow-agent-assignment-availability'
import { preflightCheck } from './workflow-preflight-check'
import { validateWorkflowPromptBoundaries } from '../../../shared/workflow-prompt-boundary-validation'
import { validateWorkflowV2Graph } from '../../../shared/workflow-v2-graph-validation'

export function buildWorkflowV2PreflightChecks(
  run: WorkflowRunRecord,
  context: {
    workspaceAvailable: boolean
    capabilityAvailable: boolean
    unavailableAgentLifecycleIds: string[]
    unavailableAgentReasons?: Record<string, WorkflowAgentUnavailableReason>
    promptHistoryIssues?: string[]
  }
): WorkflowPreflightCheck[] {
  // Runtime may store V2 JSON while WorkflowRunRecord still types snapshot as V1.
  const snapshot: unknown = run.templateSnapshot
  const definition = isWorkflowDefinitionV2(snapshot) ? snapshot : null
  const assignmentCount = new Map<string, number>()
  for (const assignment of run.assignments) {
    const key = `${assignment.nodeId}\0${assignment.slotId}`
    assignmentCount.set(key, (assignmentCount.get(key) ?? 0) + 1)
  }
  const requiredFailures: string[] = []
  const minimumFailures: string[] = []
  for (const unit of workflowAssignableUnits(snapshot)) {
    for (const slotId of unit.roleSlotIds) {
      const slot = workflowRoleSlots(snapshot).find((candidate) => candidate.id === slotId)
      if (!slot) {
        continue
      }
      const count = assignmentCount.get(`${unit.id}\0${slot.id}`) ?? 0
      if (slot.required && count === 0) {
        requiredFailures.push(`${unit.name} / ${slot.label}`)
      }
      if (count < slot.minAgents) {
        minimumFailures.push(`${unit.name} / ${slot.label}`)
      }
    }
  }
  const unavailable = new Set(context.unavailableAgentLifecycleIds)
  const unavailableAssignments = run.assignments.filter((assignment) =>
    unavailable.has(assignment.agentLifecycleId)
  )
  const unavailableDetails = unavailableAssignments.map((assignment) => {
    const unit = workflowAssignableUnits(snapshot).find(
      (candidate) => candidate.id === assignment.nodeId
    )
    const slot = workflowRoleSlots(snapshot).find((candidate) => candidate.id === assignment.slotId)
    const target = `${unit?.name ?? assignment.nodeId} / ${slot?.label ?? assignment.slotId}`
    const agent = assignment.runtimeAgent ? ` (${assignment.runtimeAgent})` : ''
    const reason = context.unavailableAgentReasons?.[assignment.agentLifecycleId]
    return `${target}${agent}: ${
      reason ? workflowAgentUnavailableReasonLabel(reason) : 'Agent is unavailable'
    }`
  })
  const hasExit = Boolean(definition?.steps.some((step) => step.kind === 'end'))
  const protocolOk = definition?.decisionProtocolVersion === WORKFLOW_DECISION_PROTOCOL_VERSION_V2
  const promptIssues = definition ? validateWorkflowPromptBoundaries(definition) : []
  const graphIssues = definition
    ? validateWorkflowV2Graph(
        definition,
        run.policyOverrides?.policyVersion === 'v2-route-traversals'
          ? run.policyOverrides.maxTraversalsByRouteId
          : {}
      )
    : ['Invalid V2 snapshot']
  return [
    preflightCheck(
      'required-slots',
      requiredFailures.length === 0,
      requiredFailures.length
        ? `Assign ${requiredFailures.join(', ')}`
        : 'All required roles assigned',
      'Assign an idle Agent to every required role'
    ),
    preflightCheck(
      'minimum-agents',
      minimumFailures.length === 0,
      minimumFailures.length
        ? `Minimum not met: ${minimumFailures.join(', ')}`
        : 'Agent minimums met',
      'Add idle Agents until each role reaches its minimum'
    ),
    preflightCheck(
      'objective',
      Boolean(run.objective.trim()),
      run.objective.trim() ? 'Task objective is present' : 'Task objective is required',
      'Enter the task objective'
    ),
    preflightCheck(
      'template-snapshot',
      true,
      `Template v${run.templateVersion} snapshot is valid`,
      null
    ),
    preflightCheck(
      'workspace-context',
      context.workspaceAvailable,
      context.workspaceAvailable ? 'Workspace context is available' : 'Workspace no longer exists',
      'Restore the workspace or create a new Draft'
    ),
    preflightCheck(
      'agent-availability',
      unavailableAssignments.length === 0,
      unavailableAssignments.length
        ? `Unavailable assignments: ${unavailableDetails.join('; ')}`
        : 'Assigned Agents are idle and reachable',
      'Wait until the listed Agent is idle, or reassign it'
    ),
    preflightCheck(
      'review-bounds',
      graphIssues.length === 0,
      graphIssues.length ? graphIssues.join('; ') : 'Every reachable V2 loop is bounded',
      'Add a traversal budget to at least one route in every loop'
    ),
    preflightCheck(
      'workflow-exit',
      hasExit,
      hasExit ? 'Workflow has a success exit' : 'No success exit',
      'Add an End step'
    ),
    preflightCheck(
      'workspace-capability',
      context.capabilityAvailable,
      context.capabilityAvailable
        ? 'Workspace and host capabilities recognized'
        : 'Host capability unavailable',
      'Reconnect the host or choose a supported workspace'
    ),
    preflightCheck(
      'decision-protocol',
      protocolOk,
      protocolOk
        ? 'Decision protocol constraints match V2 binary 完成/不完成'
        : 'V2 templates require decisionProtocolVersion v2-binary-zh',
      'Set decisionProtocolVersion to v2-binary-zh'
    ),
    preflightCheck(
      'prompt-boundaries',
      promptIssues.length === 0,
      promptIssues.length
        ? promptIssues.map((issue) => `${issue.nodeId}: ${issue.message}`).join('; ')
        : 'First-visit and repeat-visit prompt boundaries are valid',
      'Fix the listed prompt boundary or explicitly declare that repeat visits do not read history'
    ),
    preflightCheck(
      'graph-routes',
      graphIssues.length === 0,
      graphIssues.length ? graphIssues.join('; ') : 'Route targets and exits are reachable',
      'Repair unreachable exits, invalid targets, or unbounded loops'
    ),
    preflightCheck(
      'prompt-history',
      (context.promptHistoryIssues?.length ?? 0) === 0,
      context.promptHistoryIssues?.length
        ? context.promptHistoryIssues.join('; ')
        : 'Required prompt history is available',
      'Choose an available cycle and stable step ID, or remove the reference'
    )
  ]
}
