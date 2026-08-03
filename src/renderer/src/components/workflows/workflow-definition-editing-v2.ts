import type {
  WorkflowDefinitionV2,
  WorkflowStepDefinitionV2,
  WorkflowStepKindV2
} from '../../../../shared/workflow-definition-v2-types'
import { translate } from '@/i18n/i18n'

const DEFAULT_RETRY = { maxAttempts: 2, backoffMs: 1_000, onExhausted: 'human' as const }

export function addWorkflowV2Step(
  definition: WorkflowDefinitionV2,
  kind: WorkflowStepKindV2
): { definition: WorkflowDefinitionV2; stepId: string } {
  const stepId = nextStepId(definition, kind)
  const endId = definition.steps.find((step) => step.kind === 'end')?.id ?? 'end'
  const preferredRoleId = kind === 'decision' ? 'judge' : 'agent'
  const withRole = ensureRoleSlot(definition, preferredRoleId)
  const step = createStep(stepId, kind, withRole.role.id, endId)
  return {
    definition: { ...withRole.definition, steps: [...withRole.definition.steps, step] },
    stepId
  }
}

export function removeWorkflowV2Step(
  definition: WorkflowDefinitionV2,
  stepId: string
): WorkflowDefinitionV2 {
  if (definition.entryStepId === stepId) {
    throw new Error('Cannot remove the entry step.')
  }
  const target = definition.steps.find((step) => step.id === stepId)
  if (!target) {
    return definition
  }
  if (
    target.kind === 'end' &&
    definition.steps.filter((step) => step.kind === 'end').length === 1
  ) {
    throw new Error('Workflow must keep at least one End step.')
  }
  const fallback = definition.entryStepId
  return {
    ...definition,
    steps: definition.steps
      .filter((step) => step.id !== stepId)
      .map((step) => retargetStep(step, stepId, fallback))
  }
}

export function updateWorkflowV2Step(
  definition: WorkflowDefinitionV2,
  stepId: string,
  updater: (step: WorkflowStepDefinitionV2) => WorkflowStepDefinitionV2
): WorkflowDefinitionV2 {
  return {
    ...definition,
    steps: definition.steps.map((step) => (step.id === stepId ? updater(step) : step))
  }
}

export function setWorkflowV2EntryStep(
  definition: WorkflowDefinitionV2,
  stepId: string
): WorkflowDefinitionV2 {
  const step = definition.steps.find((candidate) => candidate.id === stepId)
  if (!step || (step.kind !== 'agent' && step.kind !== 'decision')) {
    throw new Error('Entry step must be agent or decision.')
  }
  return { ...definition, entryStepId: stepId }
}

function ensureRoleSlot(
  definition: WorkflowDefinitionV2,
  preferredId: string
): { definition: WorkflowDefinitionV2; role: WorkflowDefinitionV2['roleSlots'][number] } {
  const existing =
    definition.roleSlots.find((slot) => slot.id === preferredId) ?? definition.roleSlots[0]
  if (existing) {
    return { definition, role: existing }
  }
  const role: WorkflowDefinitionV2['roleSlots'][number] = {
    id: preferredId,
    label: preferredId,
    required: true,
    minAgents: 1,
    maxAgents: 1,
    execution: 'single',
    allowedAgentStates: ['idle']
  }
  return { definition: { ...definition, roleSlots: [...definition.roleSlots, role] }, role }
}

function createStep(
  stepId: string,
  kind: WorkflowStepKindV2,
  roleId: string,
  endId: string
): WorkflowStepDefinitionV2 {
  if (kind === 'end') {
    return {
      id: stepId,
      name: translate('workflows.visual.complete', 'Complete'),
      kind: 'end',
      outcome: 'succeeded'
    }
  }
  if (kind === 'human') {
    return {
      id: stepId,
      name: translate('workflows.visual.humanStep', 'Human step'),
      kind: 'human',
      routes: [
        {
          id: 'continue',
          label: translate('workflows.visual.humanContinue', 'Continue'),
          targetStepId: endId,
          requiresText: false,
          requiresConfirmation: true
        },
        {
          id: 'end',
          label: translate('workflows.visual.humanEnd', 'End'),
          targetStepId: endId,
          requiresText: false,
          requiresConfirmation: true
        }
      ]
    }
  }
  if (kind === 'decision') {
    return {
      id: stepId,
      name: translate('workflows.visual.decisionStep', 'Decision step'),
      kind: 'decision',
      roleSlotIds: [roleId],
      prompt: {
        variants: [
          {
            when: 'always',
            template:
              '目标：\n{{goal}}\n\n请判定结果。\n\n第一条非空行只能是完成或不完成。\n\n完成条件：\n{{criteria}}'
          }
        ],
        completionCriteria: translate(
          'workflows.prompt.defaultCriteria',
          'Return complete final content that satisfies this workflow goal.'
        )
      },
      parser: 'binary-complete',
      routes: {
        whenTrue: { targetStepId: endId },
        whenFalse: { targetStepId: endId, maxTraversals: 2, onExhaustedStepId: endId },
        whenInvalid: { targetStepId: endId }
      },
      retryPolicy: { ...DEFAULT_RETRY }
    }
  }
  return {
    id: stepId,
    name: translate('workflows.visual.agentStep', 'Agent step'),
    kind: 'agent',
    roleSlotIds: [roleId],
    execution: 'single',
    prompt: {
      variants: [
        {
          when: 'always',
          template:
            '工作流目标：\n{{goal}}\n\n请完成节点 {{nodeId}} 的当前任务。\n\n完成条件：\n{{criteria}}'
        }
      ],
      completionCriteria: translate(
        'workflows.prompt.defaultCriteria',
        'Return complete final content that satisfies this workflow goal.'
      )
    },
    retryPolicy: { ...DEFAULT_RETRY },
    next: { targetStepId: endId }
  }
}

function retargetStep(
  step: WorkflowStepDefinitionV2,
  removedId: string,
  fallbackId: string
): WorkflowStepDefinitionV2 {
  if (step.kind === 'agent') {
    return {
      ...step,
      next: {
        ...step.next,
        targetStepId: step.next.targetStepId === removedId ? fallbackId : step.next.targetStepId,
        onExhaustedStepId:
          step.next.onExhaustedStepId === removedId ? fallbackId : step.next.onExhaustedStepId
      }
    }
  }
  if (step.kind === 'decision') {
    const mapRoute = (route: typeof step.routes.whenTrue) => ({
      ...route,
      targetStepId: route.targetStepId === removedId ? fallbackId : route.targetStepId,
      onExhaustedStepId:
        route.onExhaustedStepId === removedId ? fallbackId : route.onExhaustedStepId
    })
    return {
      ...step,
      routes: {
        whenTrue: mapRoute(step.routes.whenTrue),
        whenFalse: mapRoute(step.routes.whenFalse),
        whenInvalid: mapRoute(step.routes.whenInvalid)
      }
    }
  }
  if (step.kind === 'human') {
    return {
      ...step,
      routes: step.routes.map((route) => ({
        ...route,
        targetStepId: route.targetStepId === removedId ? fallbackId : route.targetStepId
      }))
    }
  }
  return step
}

function nextStepId(definition: WorkflowDefinitionV2, kind: WorkflowStepKindV2): string {
  const prefix = kind === 'end' ? 'end' : kind
  let index = definition.steps.filter((step) => step.kind === kind).length + 1
  let candidate = `${prefix}-${index}`
  while (definition.steps.some((step) => step.id === candidate)) {
    index += 1
    candidate = `${prefix}-${index}`
  }
  return candidate
}
