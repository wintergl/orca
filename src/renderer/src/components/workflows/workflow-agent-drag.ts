import type { AgentActivityItem } from '../right-sidebar/agent-activity-types'
import type { WorkflowAssignableAgent } from './workflow-renderer-state'
import { WORKFLOW_AGENT_DRAG_MIME } from '../../../../shared/workflow-agent-drag-contract'

export { WORKFLOW_AGENT_DRAG_MIME } from '../../../../shared/workflow-agent-drag-contract'

type WorkflowAgentMouseDrag = {
  agent: WorkflowAssignableAgent
  startX: number
  startY: number
}

let activeMouseDrag: WorkflowAgentMouseDrag | null = null
let activeMouseUpListener: ((event: MouseEvent) => void) | null = null

function serializeWorkflowAgent(agent: WorkflowAssignableAgent): string {
  return JSON.stringify({
    id: agent.id,
    worktreeId: agent.worktreeId,
    executionHostId: agent.executionHostId,
    paneKey: agent.paneKey,
    agentLifecycleId: agent.agentLifecycleId,
    providerSessionId: agent.providerSessionId,
    runtimeAgent: agent.runtimeAgent
  })
}

export function toWorkflowAssignableAgent(item: AgentActivityItem): WorkflowAssignableAgent | null {
  const target = item.navigationTarget
  if (item.kind !== 'idle' || !target) {
    return null
  }
  return {
    id: item.id,
    label: item.title.trim() || item.runtimeAgent || item.vaultAgent || 'Agent',
    worktreeId: target.worktreeId,
    executionHostId: target.executionHostId,
    paneKey: target.paneKey,
    agentLifecycleId: target.agentLifecycleId,
    providerSessionId: target.providerSessionId,
    runtimeAgent: target.runtimeAgent,
    currentTask: item.message
  }
}

export function startWorkflowAgentMouseDrag(
  event: React.MouseEvent,
  item: AgentActivityItem
): void {
  const agent = toWorkflowAssignableAgent(item)
  if (!agent || event.button !== 0) {
    activeMouseDrag = null
    return
  }
  cancelWorkflowAgentMouseDrag()
  event.preventDefault()
  activeMouseDrag = {
    agent,
    startX: event.clientX,
    startY: event.clientY
  }
  activeMouseUpListener = (mouseUpEvent) => {
    activeMouseUpListener = null
    const agent = readWorkflowAgentMouseDrop(mouseUpEvent as unknown as React.MouseEvent)
    const element = document.elementFromPoint(mouseUpEvent.clientX, mouseUpEvent.clientY)
    const dropTarget =
      element instanceof HTMLElement
        ? element.closest<HTMLElement>('[data-workflow-agent-drop-node-id]')
        : null
    const nodeId = dropTarget?.dataset.workflowAgentDropNodeId
    const slotId = dropTarget?.dataset.workflowAgentDropSlotId
    if (agent && nodeId && slotId) {
      const button = dropTarget.querySelector<HTMLButtonElement>(
        '[data-workflow-agent-drop-button]'
      )
      if (button) {
        button.dataset.workflowAgentDropPayload = serializeWorkflowAgent(agent)
        button.click()
        delete button.dataset.workflowAgentDropPayload
      }
    }
  }
  window.addEventListener('mouseup', activeMouseUpListener, { once: true })
}

export function readWorkflowAgentMouseDrop(
  event: React.MouseEvent
): WorkflowAssignableAgent | null {
  const drag = activeMouseDrag
  activeMouseDrag = null
  if (!drag) {
    return null
  }
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
  return distance >= 8 ? drag.agent : null
}

export function cancelWorkflowAgentMouseDrag(): void {
  activeMouseDrag = null
  if (activeMouseUpListener) {
    window.removeEventListener('mouseup', activeMouseUpListener)
    activeMouseUpListener = null
  }
}

export function readWorkflowAgentMouseDropButton(
  button: HTMLButtonElement
): WorkflowAssignableAgent | null {
  const raw = button.dataset.workflowAgentDropPayload ?? ''
  delete button.dataset.workflowAgentDropPayload
  return parseWorkflowAgentDragPayload(raw)
}

export function writeWorkflowAgentDrag(event: React.DragEvent, item: AgentActivityItem): void {
  const payload = toWorkflowAssignableAgent(item)
  if (!payload) {
    event.preventDefault()
    return
  }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(WORKFLOW_AGENT_DRAG_MIME, serializeWorkflowAgent(payload))
}

function parseWorkflowAgentDragPayload(raw: string): WorkflowAssignableAgent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowAssignableAgent>
    if (
      !parsed.id ||
      !parsed.worktreeId ||
      !parsed.executionHostId ||
      !parsed.paneKey ||
      !parsed.agentLifecycleId
    ) {
      return null
    }
    return {
      id: parsed.id,
      label: parsed.label ?? 'Agent',
      worktreeId: parsed.worktreeId,
      executionHostId: parsed.executionHostId,
      paneKey: parsed.paneKey,
      agentLifecycleId: parsed.agentLifecycleId,
      providerSessionId: parsed.providerSessionId ?? null,
      runtimeAgent: parsed.runtimeAgent ?? null,
      currentTask: parsed.currentTask ?? null
    }
  } catch {
    return null
  }
}

export function readWorkflowAgentDrag(
  dataTransfer: Pick<DataTransfer, 'getData'>
): WorkflowAssignableAgent | null {
  return parseWorkflowAgentDragPayload(dataTransfer.getData(WORKFLOW_AGENT_DRAG_MIME))
}
