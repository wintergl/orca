import type { WorkflowDefinitionV1, WorkflowTemplateSnapshot } from './workflow-definition-types'
import type { WorkflowDefinitionV2, WorkflowRoleSlotV2 } from './workflow-definition-v2-types'
import { isWorkflowDefinitionV2 } from './workflow-definition-v2-schema'

export type WorkflowAssignableUnit = {
  id: string
  name: string
  roleSlotIds: string[]
}

export type WorkflowRoleSlotView = {
  id: string
  label: string
  required: boolean
  minAgents: number
  maxAgents: number
  execution: 'single' | 'parallel' | 'sequential'
}

export function isWorkflowDefinitionV1(
  definition: WorkflowTemplateSnapshot
): definition is WorkflowDefinitionV1 {
  return isV1Snapshot(definition)
}

export function requireWorkflowDefinitionV1(
  definition: WorkflowTemplateSnapshot,
  context = 'This operation'
): WorkflowDefinitionV1 {
  if (!isWorkflowDefinitionV1(definition)) {
    throw new Error(`${context} requires a V1 workflow definition.`)
  }
  return definition
}

export function requireWorkflowRunV1<Run extends { templateSnapshot: WorkflowTemplateSnapshot }>(
  run: Run,
  context = 'This operation'
): asserts run is Run & { templateSnapshot: WorkflowDefinitionV1 } {
  requireWorkflowDefinitionV1(run.templateSnapshot, context)
}

export function requireWorkflowDefinitionV2(
  definition: WorkflowTemplateSnapshot,
  context = 'This operation'
): WorkflowDefinitionV2 {
  if (!isWorkflowDefinitionV2(definition)) {
    throw new Error(`${context} requires a V2 workflow definition.`)
  }
  return definition
}

export function isWorkflowRunSnapshotV2(snapshot: unknown): snapshot is WorkflowDefinitionV2 {
  return isWorkflowDefinitionV2(snapshot)
}

export function workflowRoleSlots(snapshot: unknown): WorkflowRoleSlotView[] {
  if (isWorkflowDefinitionV2(snapshot)) {
    return snapshot.roleSlots.map(toRoleSlotView)
  }
  if (isV1Snapshot(snapshot)) {
    return snapshot.roleSlots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      required: slot.required,
      minAgents: slot.minAgents,
      maxAgents: slot.maxAgents,
      execution: slot.execution
    }))
  }
  return []
}

export function workflowAssignableUnits(snapshot: unknown): WorkflowAssignableUnit[] {
  if (isWorkflowDefinitionV2(snapshot)) {
    return snapshot.steps
      .filter((step) => step.kind === 'agent' || step.kind === 'decision')
      .map((step) => ({
        id: step.id,
        name: step.name,
        roleSlotIds: [...step.roleSlotIds]
      }))
  }
  if (isV1Snapshot(snapshot)) {
    return snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      roleSlotIds: [...node.roleSlotIds]
    }))
  }
  return []
}

function toRoleSlotView(slot: WorkflowRoleSlotV2): WorkflowRoleSlotView {
  return {
    id: slot.id,
    label: slot.label,
    required: slot.required,
    minAgents: slot.minAgents,
    maxAgents: slot.maxAgents,
    execution: slot.execution
  }
}

function isV1Snapshot(value: unknown): value is WorkflowDefinitionV1 {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as { schemaVersion?: unknown; nodes?: unknown }
  return (
    Array.isArray(candidate.nodes) &&
    (candidate.schemaVersion === undefined || candidate.schemaVersion === 1)
  )
}
