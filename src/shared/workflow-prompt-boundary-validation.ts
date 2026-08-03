import type { WorkflowDefinitionV1, WorkflowTemplateSnapshot } from './workflow-definition-types'
import type { WorkflowDefinitionV2, WorkflowPromptV2 } from './workflow-definition-v2-types'
import { isWorkflowDefinitionV2 } from './workflow-definition-v2-schema'
import { inspectWorkflowPromptInstructions } from './workflow-prompt-instructions'
import { workflowV2RouteCatalog } from './workflow-v2-route-catalog'

export type WorkflowPromptBoundaryIssue = {
  nodeId: string
  message: string
}

export function validateWorkflowPromptBoundaries(
  definition: WorkflowTemplateSnapshot
): WorkflowPromptBoundaryIssue[] {
  return isWorkflowDefinitionV2(definition)
    ? validateV2PromptBoundaries(definition)
    : validateV1PromptBoundaries(definition)
}

function validateV1PromptBoundaries(
  definition: WorkflowDefinitionV1
): WorkflowPromptBoundaryIssue[] {
  const adjacency = new Map<string, string[]>()
  for (const node of definition.nodes) {
    adjacency.set(node.id, [])
  }
  for (const transition of definition.transitions) {
    if (adjacency.has(transition.from) && adjacency.has(transition.to)) {
      adjacency.get(transition.from)!.push(transition.to)
    }
  }
  return definition.nodes.flatMap((node) => {
    if (!node.promptRules || node.type === 'human-gate' || node.type === 'complete') {
      return []
    }
    return validatePromptSet({
      nodeId: node.id,
      first: selectV1Prompt(node.promptRules.rules, 'first-visit'),
      repeat: selectV1Prompt(node.promptRules.rules, 'repeat-visit'),
      repeatVisitHistoryMode: node.promptRules.repeatVisitHistoryMode,
      repeats: hasCycle(node.id, adjacency),
      adjacency
    })
  })
}

function validateV2PromptBoundaries(
  definition: WorkflowDefinitionV2
): WorkflowPromptBoundaryIssue[] {
  const adjacency = new Map<string, string[]>()
  for (const step of definition.steps) {
    adjacency.set(step.id, [])
  }
  for (const route of workflowV2RouteCatalog(definition)) {
    adjacency.get(route.sourceStepId)?.push(route.route.targetStepId)
  }
  return definition.steps.flatMap((step) => {
    if (step.kind !== 'agent' && step.kind !== 'decision') {
      return []
    }
    return validatePromptSet({
      nodeId: step.id,
      first: selectV2Prompt(step.prompt, 'first-visit'),
      repeat: selectV2Prompt(step.prompt, 'repeat-visit'),
      repeatVisitHistoryMode: step.prompt.repeatVisitHistoryMode,
      repeats: hasCycle(step.id, adjacency),
      adjacency
    })
  })
}

function validatePromptSet(params: {
  nodeId: string
  first: string | null
  repeat: string | null
  repeatVisitHistoryMode?: 'required' | 'not-required'
  repeats: boolean
  adjacency: ReadonlyMap<string, readonly string[]>
}): WorkflowPromptBoundaryIssue[] {
  const issues: WorkflowPromptBoundaryIssue[] = []
  for (const [variant, template] of [
    ['First-visit', params.first],
    ['Repeat-visit', params.repeat]
  ] as const) {
    if (!template?.trim()) {
      continue
    }
    const inspection = inspectWorkflowPromptInstructions(template)
    if (inspection.malformed || inspection.unknown.length > 0) {
      issues.push({ nodeId: params.nodeId, message: `${variant} prompt has invalid placeholders.` })
    }
    if (!inspection.placeholders.includes('criteria')) {
      issues.push({
        nodeId: params.nodeId,
        message: `${variant} prompt must include {{criteria}}.`
      })
    }
    for (const reference of inspection.historyReferences) {
      if (!params.adjacency.has(reference.nodeId)) {
        issues.push({
          nodeId: params.nodeId,
          message: `${variant} prompt references unknown history node ${reference.nodeId}.`
        })
      } else if (
        reference.round === 'currentRound' &&
        (reference.nodeId === params.nodeId ||
          !canReach(reference.nodeId, params.nodeId, params.adjacency))
      ) {
        issues.push({
          nodeId: params.nodeId,
          message: `${variant} prompt references ${reference.nodeId} before its current-cycle output is available.`
        })
      }
    }
  }
  if (!params.first?.trim()) {
    issues.push({ nodeId: params.nodeId, message: 'First-visit prompt is required.' })
  } else if (
    inspectWorkflowPromptInstructions(params.first).historyReferences.some(
      (reference) => typeof reference.round === 'number' && reference.round < 0
    )
  ) {
    issues.push({
      nodeId: params.nodeId,
      message: 'First-visit prompt cannot reference a negative history cycle.'
    })
  }
  if (!params.repeats) {
    return issues
  }
  if (!params.repeat?.trim()) {
    issues.push({ nodeId: params.nodeId, message: 'Repeat-visit prompt is required for a loop.' })
    return issues
  }
  const history = inspectWorkflowPromptInstructions(params.repeat).historyReferences
  if (history.length === 0 && params.repeatVisitHistoryMode !== 'not-required') {
    issues.push({
      nodeId: params.nodeId,
      message: 'Repeat-visit prompt must reference history or explicitly declare no history.'
    })
  }
  return issues
}

function canReach(
  start: string,
  target: string,
  adjacency: ReadonlyMap<string, readonly string[]>
): boolean {
  const pending = [...(adjacency.get(start) ?? [])]
  const seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === target) {
      return true
    }
    if (!seen.has(current)) {
      seen.add(current)
      pending.push(...(adjacency.get(current) ?? []))
    }
  }
  return false
}

function selectV1Prompt(
  rules: WorkflowDefinitionV1['nodes'][number]['promptRules'] extends infer _Rules
    ? NonNullable<WorkflowDefinitionV1['nodes'][number]['promptRules']>['rules']
    : never,
  when: 'first-visit' | 'repeat-visit'
): string | null {
  return (
    rules.find((rule) => rule.when === when)?.template ??
    rules.find((rule) => rule.when === 'always')?.template ??
    null
  )
}

function selectV2Prompt(
  prompt: WorkflowPromptV2,
  when: 'first-visit' | 'repeat-visit'
): string | null {
  return (
    prompt.variants.find((variant) => variant.when === when)?.template ??
    prompt.variants.find((variant) => variant.when === 'always')?.template ??
    null
  )
}

function hasCycle(start: string, adjacency: ReadonlyMap<string, readonly string[]>): boolean {
  const pending = [...(adjacency.get(start) ?? [])]
  const seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === start) {
      return true
    }
    if (seen.has(current)) {
      continue
    }
    seen.add(current)
    pending.push(...(adjacency.get(current) ?? []))
  }
  return false
}
