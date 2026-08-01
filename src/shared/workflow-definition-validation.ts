import type { z } from 'zod'
import type { WorkflowDefinitionV1 } from './workflow-definition-types'
import {
  inspectWorkflowPromptInstructions,
  workflowPromptPlaceholderBinding
} from './workflow-prompt-instructions'

const terminalTargets = new Set(['run:completed', 'run:cancelled', 'run:review-limit-reached'])

function duplicateIds(values: readonly { id: string }[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) {
      duplicates.add(value.id)
    }
    seen.add(value.id)
  }
  return [...duplicates]
}

function transitionMatchesNode(when: string, type: string): boolean {
  if (when === 'step:succeeded') {
    return type === 'produce' || type === 'review'
  }
  if (when.startsWith('decision:')) {
    return type === 'decide'
  }
  if (when.startsWith('human:')) {
    return type === 'human-gate'
  }
  return false
}

function validateReviewLoops(
  definition: WorkflowDefinitionV1,
  nodes: Map<string, WorkflowDefinitionV1['nodes'][number]>,
  context: z.RefinementCtx
): void {
  for (const transition of definition.transitions) {
    const target = nodes.get(transition.to)
    if (
      target?.type === 'produce' &&
      transition.from !== definition.entryNodeId &&
      !['decision:revise', 'human:revise', 'decision:approve', 'human:approve'].includes(
        transition.when
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Only revision transitions may loop to produce' })
    }
    if (transition.when === 'decision:revise') {
      const hasBoundedReview = definition.transitions.some(
        (candidate) =>
          candidate.to === transition.from && nodes.get(candidate.from)?.type === 'review'
      )
      if (!hasBoundedReview) {
        context.addIssue({
          code: 'custom',
          message: `Revision ${transition.id} lacks a review bound`
        })
      }
    }
  }
}

function validateReachability(
  definition: WorkflowDefinitionV1,
  nodes: Map<string, WorkflowDefinitionV1['nodes'][number]>,
  context: z.RefinementCtx
): void {
  const reachable = new Set<string>()
  const pending = [definition.entryNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || reachable.has(nodeId) || !nodes.has(nodeId)) {
      continue
    }
    reachable.add(nodeId)
    for (const transition of definition.transitions) {
      if (transition.from === nodeId && nodes.has(transition.to)) {
        pending.push(transition.to)
      }
    }
  }
  for (const node of definition.nodes) {
    if (!reachable.has(node.id)) {
      context.addIssue({ code: 'custom', message: `Node ${node.id} is unreachable` })
    }
  }
}

function validateTransitions(
  definition: WorkflowDefinitionV1,
  nodes: Map<string, WorkflowDefinitionV1['nodes'][number]>,
  context: z.RefinementCtx
): void {
  const outgoing = new Map<string, WorkflowDefinitionV1['transitions']>()
  for (const transition of definition.transitions) {
    const source = nodes.get(transition.from)
    if (!source) {
      context.addIssue({ code: 'custom', message: `Unknown transition source ${transition.from}` })
      continue
    }
    if (!nodes.has(transition.to) && !terminalTargets.has(transition.to)) {
      context.addIssue({ code: 'custom', message: `Unknown transition target ${transition.to}` })
    }
    if (!transitionMatchesNode(transition.when, source.type)) {
      context.addIssue({
        code: 'custom',
        message: `${transition.when} is invalid for ${source.type}`
      })
    }
    if (
      transition.when === 'decision:request-human' &&
      nodes.get(transition.to)?.type !== 'human-gate'
    ) {
      context.addIssue({ code: 'custom', message: 'Human requests must enter a human gate' })
    }
    const rows = outgoing.get(transition.from) ?? []
    rows.push(transition)
    outgoing.set(transition.from, rows)
  }
  for (const node of definition.nodes) {
    const rows = outgoing.get(node.id) ?? []
    if (node.type === 'complete' && rows.length > 0) {
      context.addIssue({ code: 'custom', message: 'Complete cannot have outgoing transitions' })
    }
    if (node.type !== 'complete' && rows.length === 0) {
      context.addIssue({ code: 'custom', message: `Node ${node.id} has no exit` })
    }
    if (node.type === 'human-gate' && rows.some((row) => !row.when.startsWith('human:'))) {
      context.addIssue({ code: 'custom', message: `Human gate ${node.id} has an invalid exit` })
    }
  }
  validateReviewLoops(definition, nodes, context)
  validateReachability(definition, nodes, context)
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinitionV1,
  context: z.RefinementCtx
): void {
  for (const [label, values] of [
    ['role slot', definition.roleSlots],
    ['node', definition.nodes],
    ['transition', definition.transitions]
  ] as const) {
    for (const duplicate of duplicateIds(values)) {
      context.addIssue({ code: 'custom', message: `Duplicate ${label} ID: ${duplicate}` })
    }
  }
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]))
  const slots = new Map(definition.roleSlots.map((slot) => [slot.id, slot]))
  if (nodes.get(definition.entryNodeId)?.type !== 'produce') {
    context.addIssue({ code: 'custom', message: 'Entry node must be a produce node' })
  }
  if (definition.nodes.filter((node) => node.type === 'complete').length !== 1) {
    context.addIssue({ code: 'custom', message: 'Definition must have exactly one complete node' })
  }
  for (const node of definition.nodes) {
    if (duplicateIds(node.roleSlotIds.map((id) => ({ id }))).length > 0) {
      context.addIssue({ code: 'custom', message: `Node ${node.id} repeats a role slot` })
    }
    for (const slotId of node.roleSlotIds) {
      if (!slots.has(slotId)) {
        context.addIssue({ code: 'custom', message: `Node ${node.id} uses unknown slot ${slotId}` })
      }
    }
    if (node.type === 'complete') {
      if (
        node.roleSlotIds.length ||
        node.promptTemplateKey !== null ||
        (node.promptInstructions ?? null) !== null ||
        node.promptRules
      ) {
        context.addIssue({ code: 'custom', message: 'Complete cannot have roles or a prompt' })
      }
    } else if (
      node.type !== 'human-gate' &&
      node.promptTemplateKey === null &&
      !node.promptInstructions?.trim() &&
      !node.promptRules
    ) {
      context.addIssue({ code: 'custom', message: `Node ${node.id} needs a prompt` })
    }
    validatePromptInstructions(node, nodes, context)
    if (node.type === 'review') {
      const capacity = node.roleSlotIds.reduce(
        (sum, slotId) => sum + (slots.get(slotId)?.maxAgents ?? 0),
        0
      )
      if (capacity < node.reviewPolicy.minReviewers) {
        context.addIssue({ code: 'custom', message: `Review ${node.id} lacks reviewer capacity` })
      }
    }
  }
  validateTransitions(definition, nodes, context)
}

function validatePromptInstructions(
  node: WorkflowDefinitionV1['nodes'][number],
  nodes: ReadonlyMap<string, WorkflowDefinitionV1['nodes'][number]>,
  context: z.RefinementCtx
): void {
  if (node.promptRules) {
    if (node.type === 'human-gate' || node.type === 'complete') {
      context.addIssue({
        code: 'custom',
        message: `Node ${node.id} cannot define Agent prompt rules`,
        path: ['nodes', node.id, 'promptRules']
      })
      return
    }
    const conditions = new Set(node.promptRules.rules.map((rule) => rule.when))
    for (const condition of ['first-visit', 'repeat-visit'] as const) {
      if (!conditions.has(condition) && !conditions.has('always')) {
        context.addIssue({
          code: 'custom',
          message: `Node ${node.id} has no ${condition} prompt rule`,
          path: ['nodes', node.id, 'promptRules']
        })
      }
    }
    for (const rule of node.promptRules.rules) {
      validatePromptTemplate(node, rule.template, nodes, context, [
        'nodes',
        node.id,
        'promptRules',
        rule.id
      ])
    }
  }
  const template = node.promptInstructions?.trim()
  if (!template) {
    return
  }
  if (node.type === 'human-gate' || node.type === 'complete') {
    context.addIssue({
      code: 'custom',
      message: `Node ${node.id} cannot define Agent instructions`,
      path: ['nodes', node.id, 'promptInstructions']
    })
    return
  }
  validatePromptTemplate(node, template, nodes, context, ['nodes', node.id, 'promptInstructions'])
}

function validatePromptTemplate(
  node: WorkflowDefinitionV1['nodes'][number],
  template: string,
  nodes: ReadonlyMap<string, WorkflowDefinitionV1['nodes'][number]>,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  const inspection = inspectWorkflowPromptInstructions(template)
  if (inspection.malformed) {
    context.addIssue({
      code: 'custom',
      message: `Node ${node.id} has an unclosed placeholder`,
      path
    })
  }
  for (const unknown of inspection.unknown) {
    context.addIssue({
      code: 'custom',
      message: `Node ${node.id} uses unknown placeholder {{${unknown}}}`,
      path
    })
  }
  if (node.promptRules && !inspection.placeholders.includes('criteria')) {
    context.addIssue({
      code: 'custom',
      message: `Node ${node.id} prompt rule must include {{criteria}}`,
      path
    })
  }
  for (const reference of inspection.historyReferences) {
    if (!nodes.has(reference.nodeId)) {
      context.addIssue({
        code: 'custom',
        message: `Node ${node.id} references unknown history node ${reference.nodeId}`,
        path
      })
    }
  }
  for (const placeholder of inspection.placeholders) {
    const binding = workflowPromptPlaceholderBinding(placeholder)
    if (binding && !node.inputBindings.includes(binding)) {
      context.addIssue({
        code: 'custom',
        message: `Node ${node.id} placeholder {{${placeholder}}} needs input ${binding}`,
        path
      })
    }
  }
}
