import type {
  WorkflowPreflightCheck,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import {
  workflowAgentUnavailableReasonLabel,
  type WorkflowAgentUnavailableReason
} from './workflow-agent-assignment-availability'

export function buildWorkflowPreflightChecks(
  run: WorkflowRunRecord,
  context: {
    workspaceAvailable: boolean
    capabilityAvailable: boolean
    unavailableAgentLifecycleIds: string[]
    unavailableAgentReasons?: Record<string, WorkflowAgentUnavailableReason>
  }
): WorkflowPreflightCheck[] {
  const assignmentCount = new Map<string, number>()
  for (const assignment of run.assignments) {
    const key = `${assignment.nodeId}\0${assignment.slotId}`
    assignmentCount.set(key, (assignmentCount.get(key) ?? 0) + 1)
  }
  const requiredFailures: string[] = []
  const minimumFailures: string[] = []
  for (const node of run.templateSnapshot.nodes) {
    for (const slotId of node.roleSlotIds) {
      const slot = run.templateSnapshot.roleSlots.find((candidate) => candidate.id === slotId)
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
    const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === assignment.nodeId)
    const slot = run.templateSnapshot.roleSlots.find(
      (candidate) => candidate.id === assignment.slotId
    )
    const target = `${node?.name ?? assignment.nodeId} / ${slot?.label ?? assignment.slotId}`
    const agent = assignment.runtimeAgent ? ` (${assignment.runtimeAgent})` : ''
    const reason = context.unavailableAgentReasons?.[assignment.agentLifecycleId]
    return `${target}${agent}: ${
      reason ? workflowAgentUnavailableReasonLabel(reason) : 'Agent is unavailable'
    }`
  })
  const reviews = run.templateSnapshot.nodes.filter((node) => node.type === 'review')
  const reviewBoundsValid = reviews.every(
    (node) =>
      node.reviewPolicy.maxReviewRounds >= 1 &&
      node.reviewPolicy.minReviewers >= 1 &&
      run.assignments.filter((assignment) => assignment.nodeId === node.id).length >=
        node.reviewPolicy.minReviewers
  )
  const hasExit = run.templateSnapshot.nodes.some((node) => node.type === 'complete')
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
    )
  ]
}

function preflightCheck(
  id: WorkflowPreflightCheck['id'],
  passed: boolean,
  message: string,
  recovery: string | null
): WorkflowPreflightCheck {
  return {
    id,
    status: passed ? 'passed' : 'failed',
    nodeId: null,
    message,
    recovery: passed ? null : recovery
  }
}
