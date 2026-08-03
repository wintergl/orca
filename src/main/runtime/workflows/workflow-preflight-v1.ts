import type {
  WorkflowPreflightCheck,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import {
  hasWorkflowDecisionProtocolConflict,
  WORKFLOW_DECISION_PROTOCOL_VERSION_V2
} from '../../../shared/workflow-decision-protocol'
import {
  workflowAgentUnavailableReasonLabel,
  type WorkflowAgentUnavailableReason
} from './workflow-agent-assignment-availability'
import { preflightCheck } from './workflow-preflight-check'
import { validateWorkflowPromptBoundaries } from '../../../shared/workflow-prompt-boundary-validation'
import { requireWorkflowDefinitionV1 } from '../../../shared/workflow-definition-access'

export function buildWorkflowV1PreflightChecks(
  run: WorkflowRunRecord,
  context: {
    workspaceAvailable: boolean
    capabilityAvailable: boolean
    unavailableAgentLifecycleIds: string[]
    unavailableAgentReasons?: Record<string, WorkflowAgentUnavailableReason>
    promptHistoryIssues?: string[]
  }
): WorkflowPreflightCheck[] {
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 preflight')
  const assignmentCount = new Map<string, number>()
  for (const assignment of run.assignments) {
    const key = `${assignment.nodeId}\0${assignment.slotId}`
    assignmentCount.set(key, (assignmentCount.get(key) ?? 0) + 1)
  }
  const requiredFailures: string[] = []
  const minimumFailures: string[] = []
  for (const node of definition.nodes) {
    for (const slotId of node.roleSlotIds) {
      const slot = definition.roleSlots.find((candidate) => candidate.id === slotId)
      if (!slot) {
        continue
      }
      const count = assignmentCount.get(`${node.id}\0${slot.id}`) ?? 0
      if (slot.required && count === 0) {
        requiredFailures.push(`${node.name} / ${slot.label}`)
      }
      if (count < slot.minAgents) {
        minimumFailures.push(`${node.name} / ${slot.label}`)
      }
    }
  }
  const unavailable = new Set(context.unavailableAgentLifecycleIds)
  const unavailableAssignments = run.assignments.filter((assignment) =>
    unavailable.has(assignment.agentLifecycleId)
  )
  const unavailableDetails = unavailableAssignments.map((assignment) => {
    const node = definition.nodes.find((candidate) => candidate.id === assignment.nodeId)
    const slot = definition.roleSlots.find((candidate) => candidate.id === assignment.slotId)
    const target = `${node?.name ?? assignment.nodeId} / ${slot?.label ?? assignment.slotId}`
    const agent = assignment.runtimeAgent ? ` (${assignment.runtimeAgent})` : ''
    const reason = context.unavailableAgentReasons?.[assignment.agentLifecycleId]
    return `${target}${agent}: ${
      reason ? workflowAgentUnavailableReasonLabel(reason) : 'Agent is unavailable'
    }`
  })
  const reviews = definition.nodes.filter((node) => node.type === 'review')
  const reviewBoundsValid = reviews.every(
    (node) =>
      node.reviewPolicy.maxReviewRounds >= 1 &&
      node.reviewPolicy.minReviewers >= 1 &&
      run.assignments.filter((assignment) => assignment.nodeId === node.id).length >=
        node.reviewPolicy.minReviewers
  )
  const hasExit = definition.nodes.some((node) => node.type === 'complete')
  const protocolConflicts = definition.nodes
    .filter((node) => node.type === 'review' || node.type === 'decide')
    .filter((node) => hasWorkflowDecisionProtocolConflict(node.promptInstructions ?? ''))
    .map((node) => node.name)
  const explicitV2 = definition.decisionProtocolVersion === WORKFLOW_DECISION_PROTOCOL_VERSION_V2
  const promptIssues = validateWorkflowPromptBoundaries(definition)
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
      reviewBoundsValid,
      reviewBoundsValid ? 'Review rounds are bounded' : 'Review round limit is invalid',
      'Set maxReviewRounds to at least 1'
    ),
    preflightCheck(
      'workflow-exit',
      hasExit,
      hasExit ? 'Workflow has a success exit' : 'No success exit',
      'Add a Complete node'
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
      !explicitV2 && protocolConflicts.length === 0,
      explicitV2
        ? 'V2 binary decision protocol cannot run on a V1 template snapshot'
        : protocolConflicts.length
          ? `V1 decision protocol conflict in: ${protocolConflicts.join(', ')}`
          : 'Decision protocol constraints match V1 approve/revise',
      explicitV2
        ? 'Use a V2 free-form template (schemaVersion 2) for 完成/不完成'
        : 'Remove “完成/不完成” first-line constraints from Review/Decision business prompts'
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
      'prompt-history',
      (context.promptHistoryIssues?.length ?? 0) === 0,
      context.promptHistoryIssues?.length
        ? context.promptHistoryIssues.join('; ')
        : 'Required prompt history is available',
      'Choose an available cycle and stable node ID, or remove the reference'
    )
  ]
}
