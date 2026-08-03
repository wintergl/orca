import type { WorkflowInputBinding, WorkflowPromptTemplateKey } from './workflow-definition-types'

export const WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH = 20_000

export const WORKFLOW_PROMPT_PLACEHOLDERS = [
  { name: 'goal', token: '{{goal}}', inputBinding: 'root-goal' },
  { name: 'rootGoal', token: '{{rootGoal}}', inputBinding: 'root-goal' },
  { name: 'criteria', token: '{{criteria}}', inputBinding: null },
  { name: 'currentRound', token: '{{currentRound}}', inputBinding: null },
  { name: 'nodeId', token: '{{nodeId}}', inputBinding: null },
  {
    name: 'upstreamCompletion',
    token: '{{upstreamCompletion}}',
    inputBinding: 'upstream-completion'
  },
  {
    name: 'artifactRevision',
    token: '{{artifactRevision}}',
    inputBinding: 'artifact-revision'
  },
  {
    name: 'reviewAggregate',
    token: '{{reviewAggregate}}',
    inputBinding: 'review-aggregate'
  },
  { name: 'humanInstructions', token: '{{humanInstructions}}', inputBinding: null },
  { name: 'decision', token: '{{decision}}', inputBinding: 'decision' },
  { name: 'workflowName', token: '{{workflowName}}', inputBinding: null },
  { name: 'nodeName', token: '{{nodeName}}', inputBinding: null },
  { name: 'round', token: '{{round}}', inputBinding: null }
] as const satisfies readonly {
  name: string
  token: string
  inputBinding: WorkflowInputBinding | null
}[]

export type WorkflowPromptPlaceholderName = (typeof WORKFLOW_PROMPT_PLACEHOLDERS)[number]['name']

export type WorkflowPromptPlaceholderValues = Partial<Record<WorkflowPromptPlaceholderName, string>>

export type WorkflowPromptHistoryEntry = {
  round: number
  nodeId: string
  output: string
  sequence: number
}

export type WorkflowPromptHistoryReference = {
  source: string
  round: number | 'currentRound'
  nodeId: string
}

export type WorkflowPromptRenderContext = {
  currentRound: number
  history: readonly WorkflowPromptHistoryEntry[]
}

const PLACEHOLDER_BY_NAME: ReadonlyMap<string, (typeof WORKFLOW_PROMPT_PLACEHOLDERS)[number]> =
  new Map(WORKFLOW_PROMPT_PLACEHOLDERS.map((placeholder) => [placeholder.name, placeholder]))
const PLACEHOLDER_PATTERN = /{{\s*([^{}]+?)\s*}}/g
const HISTORY_REFERENCE_PATTERN =
  /^history\[(-?\d+|currentRound)\]\.nodes\["([A-Za-z0-9._:-]+)"\]\.output$/

const DEFAULT_PROMPT_INSTRUCTIONS: Record<WorkflowPromptTemplateKey, string> = {
  'builtin.spec.produce.v1': `当前工作目标为：
{{rootGoal}}

请完成本轮 SPEC。

上一轮评审意见：
{{reviewAggregate}}

人工修改要求：
{{humanInstructions}}`,
  'builtin.spec.review.v1': `当前工作目标为：
{{rootGoal}}

上游 Agent 的完成结论为：
{{upstreamCompletion}}

本轮完成的 SPEC 为：
{{artifactRevision}}

请结合工作目标和冻结的 SPEC 评审此结果。`,
  'builtin.spec.decide.v1': `当前工作目标为：
{{rootGoal}}

本轮完成的 SPEC 为：
{{artifactRevision}}

评审汇总为：
{{reviewAggregate}}

请判断该 SPEC 应通过、修改或请求人工处理。`,
  'builtin.code.produce.v1': `当前工作目标为：
{{rootGoal}}

已确认的 SPEC 或上游结果为：
{{artifactRevision}}

上游 Agent 的完成结论为：
{{upstreamCompletion}}

上一轮代码评审汇总为：
{{reviewAggregate}}

人工修改要求：
{{humanInstructions}}

请依据上述内容实现或修订代码。`,
  'builtin.code.review.v1': `当前工作目标为：
{{rootGoal}}

上游 Agent 的完成结论为：
{{upstreamCompletion}}

本轮完成的代码为：
{{artifactRevision}}

请结合工作目标和冻结的代码评审此结果。`,
  'builtin.code.decide.v1': `当前工作目标为：
{{rootGoal}}

本轮完成的代码为：
{{artifactRevision}}

评审汇总为：
{{reviewAggregate}}

请判断该实现应通过、修改或请求人工处理。`
}

export function defaultWorkflowPromptInstructions(key: WorkflowPromptTemplateKey | null): string {
  return key ? DEFAULT_PROMPT_INSTRUCTIONS[key] : ''
}

export function inspectWorkflowPromptInstructions(template: string): {
  placeholders: WorkflowPromptPlaceholderName[]
  historyReferences: WorkflowPromptHistoryReference[]
  unknown: string[]
  malformed: boolean
} {
  const placeholders = new Set<WorkflowPromptPlaceholderName>()
  const historyReferences = new Map<string, WorkflowPromptHistoryReference>()
  const unknown = new Set<string>()
  const matchedRanges: [number, number][] = []
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]?.trim() ?? ''
    const placeholder = PLACEHOLDER_BY_NAME.get(name)
    if (placeholder) {
      placeholders.add(placeholder.name)
    } else {
      const historyReference = parseWorkflowPromptHistoryReference(name)
      if (historyReference) {
        historyReferences.set(name, historyReference)
      } else {
        unknown.add(name)
      }
    }
    matchedRanges.push([match.index, match.index + match[0].length])
  }
  let unmatched = ''
  let cursor = 0
  for (const [start, end] of matchedRanges) {
    unmatched += template.slice(cursor, start)
    cursor = end
  }
  unmatched += template.slice(cursor)
  return {
    placeholders: [...placeholders],
    historyReferences: [...historyReferences.values()],
    unknown: [...unknown],
    malformed: unmatched.includes('{{') || unmatched.includes('}}')
  }
}

export function workflowPromptPlaceholderBinding(
  name: WorkflowPromptPlaceholderName
): WorkflowInputBinding | null {
  return PLACEHOLDER_BY_NAME.get(name)?.inputBinding ?? null
}

export function requiredWorkflowPromptInputBindings(template: string): WorkflowInputBinding[] {
  const bindings = new Set<WorkflowInputBinding>()
  for (const name of inspectWorkflowPromptInstructions(template).placeholders) {
    const binding = workflowPromptPlaceholderBinding(name)
    if (binding) {
      bindings.add(binding)
    }
  }
  return [...bindings]
}

export function renderWorkflowPromptInstructions(
  template: string,
  values: WorkflowPromptPlaceholderValues,
  context?: WorkflowPromptRenderContext
): string {
  return template
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph.replace(PLACEHOLDER_PATTERN, (_match, rawName: string) => {
        const name = rawName.trim()
        if (PLACEHOLDER_BY_NAME.has(name)) {
          return values[name as WorkflowPromptPlaceholderName]?.trim() ?? ''
        }
        const historyReference = parseWorkflowPromptHistoryReference(name)
        if (!historyReference || !context) {
          return ''
        }
        return resolveWorkflowPromptHistoryReference(historyReference, context)
      })
    )
    .filter(hasRenderedPromptContent)
    .join('\n\n')
    .trim()
}

function hasRenderedPromptContent(paragraph: string): boolean {
  const value = paragraph.trim()
  return value.length > 0 && !/^[^。！？.!?\n]{1,80}[:：]\s*$/.test(value)
}

export function parseWorkflowPromptHistoryReference(
  source: string
): WorkflowPromptHistoryReference | null {
  const match = HISTORY_REFERENCE_PATTERN.exec(source.trim())
  if (!match) {
    return null
  }
  const round = match[1] === 'currentRound' ? 'currentRound' : Number(match[1])
  if (round === 0) {
    return null
  }
  return {
    source: source.trim(),
    round,
    nodeId: match[2]!
  }
}

export function workflowPromptHistoryToken(round: number | 'currentRound', nodeId: string): string {
  return `{{ history[${round}].nodes["${nodeId}"].output }}`
}

export function workflowPromptHistoryReferenceRound(
  reference: WorkflowPromptHistoryReference,
  currentRound: number
): number {
  return reference.round === 'currentRound'
    ? currentRound
    : reference.round < 0
      ? currentRound + reference.round
      : reference.round
}

function resolveWorkflowPromptHistoryReference(
  reference: WorkflowPromptHistoryReference,
  context: WorkflowPromptRenderContext
): string {
  const round = workflowPromptHistoryReferenceRound(reference, context.currentRound)
  const outputs = context.history
    .filter((entry) => entry.round === round && entry.nodeId === reference.nodeId)
    .toSorted((left, right) => left.sequence - right.sequence)
    .map((entry) => entry.output.trim())
    .filter(Boolean)
  if (outputs.length === 0) {
    throw new Error(
      `Missing workflow history output for round ${round}, node "${reference.nodeId}"`
    )
  }
  return outputs.join('\n\n')
}
