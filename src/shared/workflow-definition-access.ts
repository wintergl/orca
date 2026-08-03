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
}

export function isWorkflowDefinitionV1(
  definition: WorkflowTemplateSnapshot
): definition is WorkflowDefinitionV1 {
  return definition.schemaVersion === 1
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

export function requireWorkflowDefinitionV2(
  definition: WorkflowTemplateSnapshot,
  context = 'This operation'
): WorkflowDefinitionV2 {
  if (!isWorkflowDefinitionV2(definition)) {
    throw new Error(`${context} requires a V2 workflow definition.`)
  }
  return definition
}

/** Runtime may still type snapshots as V1 while V2 JSON is stored. */
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
      maxAgents: slot.maxAgents
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
    maxAgents: slot.maxAgents
  }
}

function isV1Snapshot(value: unknown): value is WorkflowDefinitionV1 {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as WorkflowDefinitionV1).nodes)
  )
}
