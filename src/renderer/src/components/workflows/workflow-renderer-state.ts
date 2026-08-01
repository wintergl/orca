import { useSyncExternalStore } from 'react'
import type {
  WorkflowPreflightResult,
  WorkflowRunRecord,
  WorkflowTemplateRecord
} from '../../../../shared/workflow-definition-types'

export type WorkflowAssignableAgent = {
  id: string
  label: string
  worktreeId: string
  executionHostId: string
  paneKey: string
  agentLifecycleId: string
  providerSessionId: string | null
  runtimeAgent: string | null
  currentTask: string | null
}

export type WorkflowAgentDisplayContext = {
  workflowName: string
  nodeName: string
  round: number
  status: WorkflowRunRecord['steps'][number]['status']
  sentToNodeName: string | null
}

export type WorkflowPage = 'templates' | 'application' | 'runs'

export type WorkflowRendererSnapshot = {
  page: WorkflowPage
  selectedTemplate: WorkflowTemplateRecord | null
  activeRun: WorkflowRunRecord | null
  preflight: WorkflowPreflightResult | null
  selectedStepRunId: string | null
  availableAgents: readonly WorkflowAssignableAgent[]
}

const EMPTY_SNAPSHOT: WorkflowRendererSnapshot = {
  page: 'templates',
  selectedTemplate: null,
  activeRun: null,
  preflight: null,
  selectedStepRunId: null,
  availableAgents: []
}

let snapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

export function useWorkflowRendererState(): WorkflowRendererSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getWorkflowSelectedTemplate(): WorkflowTemplateRecord | null {
  return snapshot.selectedTemplate
}

export function setWorkflowSelectedTemplate(template: WorkflowTemplateRecord | null): void {
  update({ selectedTemplate: template, preflight: null })
}

export function setWorkflowPage(page: WorkflowPage): void {
  update({ page })
}

export function setWorkflowActiveRun(run: WorkflowRunRecord | null): void {
  const isSameSetupRun = run?.id === snapshot.activeRun?.id
  update({
    activeRun: run,
    preflight:
      isSameSetupRun && (run?.status === 'draft' || run?.status === 'ready')
        ? snapshot.preflight
        : null
  })
}

export function setWorkflowPreflight(preflight: WorkflowPreflightResult | null): void {
  update({ preflight, activeRun: preflight?.run ?? snapshot.activeRun })
}

export function setWorkflowAssignableAgents(
  availableAgents: readonly WorkflowAssignableAgent[]
): void {
  if (sameAgents(snapshot.availableAgents, availableAgents)) {
    return
  }
  update({ availableAgents })
}

export function setWorkflowSelectedStep(stepRunId: string | null): void {
  update({ selectedStepRunId: stepRunId })
}

export function clearWorkflowSetup(): void {
  update({
    page: 'templates',
    activeRun: null,
    preflight: null,
    selectedStepRunId: null
  })
}

function update(patch: Partial<WorkflowRendererSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): WorkflowRendererSnapshot {
  return snapshot
}

function sameAgents(
  left: readonly WorkflowAssignableAgent[],
  right: readonly WorkflowAssignableAgent[]
): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every(
    (agent, index) =>
      agent.id === right[index]?.id &&
      agent.label === right[index]?.label &&
      agent.agentLifecycleId === right[index]?.agentLifecycleId &&
      agent.worktreeId === right[index]?.worktreeId &&
      agent.executionHostId === right[index]?.executionHostId &&
      agent.paneKey === right[index]?.paneKey &&
      agent.providerSessionId === right[index]?.providerSessionId &&
      agent.runtimeAgent === right[index]?.runtimeAgent &&
      agent.currentTask === right[index]?.currentTask
  )
}
