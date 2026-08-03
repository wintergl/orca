import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { WorkflowV2RuntimeSurface } from './workflow-v2-run-controller'

export function visitSiblingSteps(
  store: WorkflowV2RuntimeSurface,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): WorkflowStepRunRecord[] {
  const rows = store.db
    .prepare(
      `SELECT id FROM workflow_step_runs
       WHERE run_id = ? AND node_id = ? AND round = ?
       ORDER BY rowid`
    )
    .all(run.id, step.nodeId, step.round) as { id: string }[]
  return rows
    .map((row) => store.getStep(row.id))
    .filter((candidate): candidate is WorkflowStepRunRecord => Boolean(candidate))
}

export function visitAssignmentsComplete(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  siblings: WorkflowStepRunRecord[]
): boolean {
  const required = run.assignments.filter((assignment) => assignment.nodeId === step.nodeId)
  if (required.length === 0) {
    return siblings.every((candidate) => candidate.status === 'succeeded')
  }
  return required.every((assignment) =>
    siblings.some(
      (sibling) =>
        sibling.status === 'succeeded' &&
        sibling.assignment?.slotId === assignment.slotId &&
        sibling.assignment.agentLifecycleId === assignment.agentLifecycleId
    )
  )
}

export function collectAgentOutputs(siblings: WorkflowStepRunRecord[]): {
  slotId: string
  agentIdentity: string
  finalText: string
}[] {
  return siblings
    .filter((sibling) => sibling.status === 'succeeded' && sibling.assignment)
    .map((sibling) => ({
      slotId: sibling.assignment!.slotId,
      agentIdentity: sibling.assignment!.agentLifecycleId,
      finalText: sibling.conclusionMarkdown?.trim() || ''
    }))
    .toSorted((left, right) =>
      left.slotId === right.slotId
        ? left.agentIdentity.localeCompare(right.agentIdentity)
        : left.slotId.localeCompare(right.slotId)
    )
}

export function composeParallelFinalText(
  outputs: { slotId: string; agentIdentity: string; finalText: string }[]
): string {
  if (outputs.length <= 1) {
    return outputs[0]?.finalText ?? ''
  }
  return outputs
    .map((output) => `[${output.slotId}/${output.agentIdentity}]\n${output.finalText}`)
    .join('\n\n')
}
