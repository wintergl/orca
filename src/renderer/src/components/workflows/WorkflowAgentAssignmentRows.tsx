import { useMemo } from 'react'
import { ArrowRight, Bot, Plus, X } from 'lucide-react'
import type {
  WorkflowAgentAssignment,
  WorkflowNodeDefinitionV1,
  WorkflowRoleSlot,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkflowAssignableAgent } from './workflow-renderer-state'
import {
  readWorkflowAgentDrag,
  readWorkflowAgentMouseDropButton,
  WORKFLOW_AGENT_DRAG_MIME
} from './workflow-agent-drag'

export type WorkflowAssignmentTarget = { nodeId: string; slotId: string }

export function WorkflowAgentAssignmentRows({
  run,
  onChoose,
  onAssign,
  onUnassign
}: {
  run: WorkflowRunRecord
  onChoose: (target: WorkflowAssignmentTarget) => void
  onAssign: (target: WorkflowAssignmentTarget, agent: WorkflowAssignableAgent) => void
  onUnassign: (assignment: WorkflowAgentAssignment) => void
}): React.JSX.Element {
  const { assignableNodes, assignmentsByTarget, slotsById } = useMemo(
    () => buildAssignmentRows(run),
    [run]
  )

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {assignableNodes.map(({ node, workflowIndex }) => (
          <section
            key={node.id}
            className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1.6fr)] md:gap-5"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                {workflowIndex + 1}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">{node.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{runNodeSummary(node)}</p>
              </div>
            </div>
            <div className="space-y-2">
              {node.roleSlotIds.map((slotId) => {
                const slot = slotsById.get(slotId)
                if (!slot) {
                  return null
                }
                const target = { nodeId: node.id, slotId }
                const assignments = assignmentsByTarget.get(targetKey(target)) ?? []
                return (
                  <AssignmentSlotRow
                    key={slotId}
                    target={target}
                    slot={slot}
                    assignments={assignments}
                    onChoose={onChoose}
                    onAssign={onAssign}
                    onUnassign={onUnassign}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <WorkflowSequence nodes={run.templateSnapshot.nodes} />
    </div>
  )
}

function AssignmentSlotRow({
  target,
  slot,
  assignments,
  onChoose,
  onAssign,
  onUnassign
}: {
  target: WorkflowAssignmentTarget
  slot: WorkflowRoleSlot
  assignments: readonly WorkflowAgentAssignment[]
  onChoose: (target: WorkflowAssignmentTarget) => void
  onAssign: (target: WorkflowAssignmentTarget, agent: WorkflowAssignableAgent) => void
  onUnassign: (assignment: WorkflowAgentAssignment) => void
}): React.JSX.Element {
  return (
    <div
      className="grid min-h-12 items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 transition-colors hover:border-muted-foreground/50 sm:grid-cols-[minmax(9rem,0.75fr)_minmax(0,1.25fr)_auto]"
      data-workflow-agent-drop-node-id={target.nodeId}
      data-workflow-agent-drop-slot-id={target.slotId}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKFLOW_AGENT_DRAG_MIME)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        const agent = readWorkflowAgentDrag(event.dataTransfer)
        if (agent) {
          onAssign(target, agent)
        }
      }}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{slot.label}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {slot.required
            ? translate('workflows.run.required', 'Required')
            : translate('workflows.run.optional', 'Optional')}{' '}
          · {slot.minAgents}–{slot.maxAgents} · {roleExecutionLabel(slot.execution)}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {assignments.map((assignment) => (
          <div
            key={assignment.agentLifecycleId}
            className="flex min-w-0 max-w-40 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1"
          >
            <Bot className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs">
              {assignment.runtimeAgent ?? translate('workflows.run.agent', 'Agent')}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onUnassign(assignment)}
              aria-label={translate('workflows.run.removeAria', 'Remove {{value0}}', {
                value0: assignment.agentLifecycleId
              })}
            >
              <X />
            </Button>
          </div>
        ))}
        {assignments.length === 0 ? (
          <button
            type="button"
            className="min-h-7 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChoose(target)}
          >
            {translate('workflows.run.dropAgent', 'Drop an idle Agent here or click to choose')}
          </button>
        ) : null}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={assignments.length >= slot.maxAgents}
        data-workflow-agent-drop-button
        onClick={(event) => {
          const draggedAgent = readWorkflowAgentMouseDropButton(event.currentTarget)
          if (draggedAgent) {
            onAssign(target, draggedAgent)
            return
          }
          onChoose(target)
        }}
        aria-label={translate('workflows.run.assignAria', 'Assign Agent to {{value0}}', {
          value0: slot.label
        })}
      >
        <Plus />
      </Button>
    </div>
  )
}

function WorkflowSequence({
  nodes
}: {
  nodes: readonly WorkflowNodeDefinitionV1[]
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
      {nodes.map((node, index) => (
        <span key={node.id} className="contents">
          {index > 0 ? <ArrowRight className="size-3 shrink-0" /> : null}
          <span className="whitespace-nowrap">{node.name}</span>
        </span>
      ))}
    </div>
  )
}

function buildAssignmentRows(run: WorkflowRunRecord): {
  assignableNodes: { node: WorkflowNodeDefinitionV1; workflowIndex: number }[]
  assignmentsByTarget: Map<string, WorkflowAgentAssignment[]>
  slotsById: Map<string, WorkflowRoleSlot>
} {
  const assignableNodes = run.templateSnapshot.nodes.flatMap((node, workflowIndex) =>
    node.roleSlotIds.length ? [{ node, workflowIndex }] : []
  )
  const assignmentsByTarget = new Map<string, WorkflowAgentAssignment[]>()
  for (const assignment of run.assignments) {
    const key = targetKey(assignment)
    const assignments = assignmentsByTarget.get(key)
    if (assignments) {
      assignments.push(assignment)
    } else {
      assignmentsByTarget.set(key, [assignment])
    }
  }
  return {
    assignableNodes,
    assignmentsByTarget,
    slotsById: new Map(run.templateSnapshot.roleSlots.map((slot) => [slot.id, slot]))
  }
}

function targetKey(target: WorkflowAssignmentTarget): string {
  return `${target.nodeId}\u0000${target.slotId}`
}

function runNodeSummary(node: WorkflowNodeDefinitionV1): string {
  switch (node.type) {
    case 'produce':
      return node.artifactKind === 'spec'
        ? translate('workflows.application.produceSpec', 'Create a SPEC document')
        : translate('workflows.application.produceCode', 'Create code changes')
    case 'review':
      return translate('workflows.application.reviewResult', 'Review the current result')
    case 'decide':
      return translate('workflows.application.decideNext', 'Decide the next step')
    case 'human-gate':
      return translate('workflows.application.waitHuman', 'Wait for human confirmation')
    case 'complete':
      return translate('workflows.application.completeRun', 'Complete the workflow')
  }
}

function roleExecutionLabel(execution: WorkflowRoleSlot['execution']): string {
  switch (execution) {
    case 'single':
      return translate('workflows.visual.single', 'One Agent')
    case 'parallel':
      return translate('workflows.visual.parallel', 'Work in parallel')
    case 'sequential':
      return translate('workflows.visual.sequential', 'Work in sequence')
  }
}
