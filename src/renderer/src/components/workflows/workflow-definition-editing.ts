import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowPromptRulesV1,
  WorkflowRoleSlot,
  WorkflowTransitionV1
} from '../../../../shared/workflow-definition-types'
import { defaultWorkflowPromptInstructions } from '../../../../shared/workflow-prompt-instructions'
import { translate } from '@/i18n/i18n'

export type WorkflowNodeType = WorkflowNodeDefinitionV1['type']

export function updateWorkflowNode(
  definition: WorkflowDefinitionV1,
  nodeId: string,
  update: (node: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1
): WorkflowDefinitionV1 {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => (node.id === nodeId ? update(node) : node))
  }
}

export function moveWorkflowNode(
  definition: WorkflowDefinitionV1,
  nodeId: string,
  offset: -1 | 1
): WorkflowDefinitionV1 {
  const index = definition.nodes.findIndex((node) => node.id === nodeId)
  const targetIndex = index + offset
  if (index < 0 || targetIndex < 0 || targetIndex >= definition.nodes.length) {
    return definition
  }
  const nodes = [...definition.nodes]
  ;[nodes[index], nodes[targetIndex]] = [nodes[targetIndex], nodes[index]]
  return { ...definition, nodes }
}

export function addWorkflowNode(
  definition: WorkflowDefinitionV1,
  type: WorkflowNodeType
): { definition: WorkflowDefinitionV1; nodeId: string } {
  const nodeId = nextId(
    type,
    definition.nodes.map((node) => node.id)
  )
  const node = createNode(definition, type, nodeId)
  const completeIndex = definition.nodes.findIndex((candidate) => candidate.type === 'complete')
  const nodes = [...definition.nodes]
  nodes.splice(completeIndex < 0 ? nodes.length : completeIndex, 0, node)
  return {
    definition: { ...definition, nodes },
    nodeId
  }
}

export function removeWorkflowNode(
  definition: WorkflowDefinitionV1,
  nodeId: string
): WorkflowDefinitionV1 {
  if (nodeId === definition.entryNodeId) {
    return definition
  }
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.type === 'complete') {
    return definition
  }
  return {
    ...definition,
    nodes: definition.nodes.filter((candidate) => candidate.id !== nodeId),
    transitions: definition.transitions.filter(
      (transition) => transition.from !== nodeId && transition.to !== nodeId
    )
  }
}

export function addWorkflowRoleSlot(definition: WorkflowDefinitionV1): {
  definition: WorkflowDefinitionV1
  slotId: string
} {
  const slotId = nextId(
    'role',
    definition.roleSlots.map((slot) => slot.id)
  )
  const slot: WorkflowRoleSlot = {
    id: slotId,
    label: translate('workflows.visual.newRoleName', 'New role'),
    required: true,
    minAgents: 1,
    maxAgents: 1,
    execution: 'single',
    allowedAgentStates: ['idle']
  }
  return {
    definition: { ...definition, roleSlots: [...definition.roleSlots, slot] },
    slotId
  }
}

export function updateWorkflowRoleSlot(
  definition: WorkflowDefinitionV1,
  slotId: string,
  update: (slot: WorkflowRoleSlot) => WorkflowRoleSlot
): WorkflowDefinitionV1 {
  return {
    ...definition,
    roleSlots: definition.roleSlots.map((slot) => (slot.id === slotId ? update(slot) : slot))
  }
}

export function removeWorkflowRoleSlot(
  definition: WorkflowDefinitionV1,
  slotId: string
): WorkflowDefinitionV1 {
  return {
    ...definition,
    roleSlots: definition.roleSlots.filter((slot) => slot.id !== slotId),
    nodes: definition.nodes.map((node) => ({
      ...node,
      roleSlotIds: node.roleSlotIds.filter((id) => id !== slotId)
    }))
  }
}

export function addWorkflowTransition(
  definition: WorkflowDefinitionV1,
  sourceNode: WorkflowNodeDefinitionV1
): WorkflowDefinitionV1 {
  const transitionId = nextId(
    `${sourceNode.id}-transition`,
    definition.transitions.map((transition) => transition.id)
  )
  const target =
    definition.nodes.find((node) => node.id !== sourceNode.id && node.type === 'complete')?.id ??
    definition.nodes.find((node) => node.id !== sourceNode.id)?.id ??
    'run:completed'
  const transition: WorkflowTransitionV1 = {
    id: transitionId,
    from: sourceNode.id,
    when: defaultTransitionCondition(sourceNode.type),
    to: target
  }
  return { ...definition, transitions: [...definition.transitions, transition] }
}

export function updateWorkflowTransition(
  definition: WorkflowDefinitionV1,
  transitionId: string,
  update: (transition: WorkflowTransitionV1) => WorkflowTransitionV1
): WorkflowDefinitionV1 {
  return {
    ...definition,
    transitions: definition.transitions.map((transition) =>
      transition.id === transitionId ? update(transition) : transition
    )
  }
}

export function removeWorkflowTransition(
  definition: WorkflowDefinitionV1,
  transitionId: string
): WorkflowDefinitionV1 {
  return {
    ...definition,
    transitions: definition.transitions.filter((transition) => transition.id !== transitionId)
  }
}

function createNode(
  definition: WorkflowDefinitionV1,
  type: WorkflowNodeType,
  id: string
): WorkflowNodeDefinitionV1 {
  const retryPolicy = { ...definition.defaults.retryPolicy }
  const base = {
    id,
    name: nodeTypeName(type),
    roleSlotIds: [],
    promptTemplateKey: null,
    promptInstructions: null,
    inputBindings: [],
    retryPolicy
  }
  if (type === 'produce') {
    return {
      ...base,
      type,
      promptTemplateKey: 'builtin.code.produce.v1',
      promptInstructions: defaultWorkflowPromptInstructions('builtin.code.produce.v1'),
      promptRules: createPromptRules(definition, id, type),
      inputBindings: ['root-goal', 'upstream-completion', 'artifact-revision', 'review-aggregate'],
      artifactKind: 'code',
      outputSchema: 'workflow.completion/v1'
    }
  }
  if (type === 'review') {
    return {
      ...base,
      type,
      promptTemplateKey: 'builtin.code.review.v1',
      promptInstructions: defaultWorkflowPromptInstructions('builtin.code.review.v1'),
      promptRules: createPromptRules(definition, id, type),
      inputBindings: ['root-goal', 'upstream-completion', 'artifact-revision'],
      reviewPolicy: {
        minReviewers: 1,
        completion: 'all-required',
        onReviewerFailure: 'wait-human',
        timeoutMs: 3_600_000,
        maxReviewRounds: 3
      },
      outputSchema: 'workflow.review-result/v1'
    }
  }
  if (type === 'decide') {
    return {
      ...base,
      type,
      promptTemplateKey: 'builtin.code.decide.v1',
      promptInstructions: defaultWorkflowPromptInstructions('builtin.code.decide.v1'),
      promptRules: createPromptRules(definition, id, type),
      inputBindings: ['root-goal', 'artifact-revision', 'review-aggregate'],
      mode: 'rules',
      outputSchema: 'workflow.decision/v1'
    }
  }
  if (type === 'human-gate') {
    return {
      ...base,
      type,
      inputBindings: ['decision'],
      waitingReasons: ['review-request-human'],
      allowedActions: ['view-evidence', 'approve', 'revise', 'end-workflow'],
      outputSchema: 'workflow.human-resolution/v1'
    }
  }
  return {
    ...base,
    type,
    outcome: 'succeeded',
    outputSchema: null
  }
}

function createPromptRules(
  definition: WorkflowDefinitionV1,
  nodeId: string,
  type: Extract<WorkflowNodeType, 'produce' | 'review' | 'decide'>
): WorkflowPromptRulesV1 {
  const previousNodeId =
    definition.nodes
      .toReversed()
      .find((node) => node.type !== 'human-gate' && node.type !== 'complete')?.id ?? nodeId
  // Why: output protocol is Engine-owned; business prompts must not invent V2 binary tokens.
  const task =
    type === 'review'
      ? '请评审输入内容并给出完整结论。'
      : type === 'decide'
        ? '请判断当前结果是否满足完成条件，并给出明确裁定理由。'
        : '请生成满足目标的完整结果。'
  return {
    rules: [
      {
        id: 'first-visit',
        name: '首次进入',
        when: 'first-visit',
        template: `目标：\n{{goal}}\n\n${task}\n\n完成条件：\n{{criteria}}`
      },
      {
        id: 'repeat-visit',
        name: '再次进入',
        when: 'repeat-visit',
        template: `目标：\n{{goal}}\n\n上一轮相关结果：\n{{ history[-1].nodes["${previousNodeId}"].output }}\n\n${task}\n\n完成条件：\n{{criteria}}`
      }
    ],
    completionCriteria: '输出完整、明确，并满足当前工作流目标。'
  }
}

function defaultTransitionCondition(type: WorkflowNodeType): WorkflowTransitionV1['when'] {
  if (type === 'decide') {
    return 'decision:approve'
  }
  if (type === 'human-gate') {
    return 'human:approve'
  }
  return 'step:succeeded'
}

function nextId(prefix: string, existing: readonly string[]): string {
  const used = new Set(existing)
  let index = 1
  while (used.has(`${prefix}-${index}`)) {
    index += 1
  }
  return `${prefix}-${index}`
}

function nodeTypeName(type: WorkflowNodeType): string {
  switch (type) {
    case 'produce':
      return 'Produce'
    case 'review':
      return 'Review'
    case 'decide':
      return 'Decide'
    case 'human-gate':
      return 'Human gate'
    case 'complete':
      return 'Complete'
  }
}
