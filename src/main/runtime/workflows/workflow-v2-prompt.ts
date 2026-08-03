import type {
  WorkflowDefinitionV2,
  WorkflowHistoryEntryV2
} from '../../../shared/workflow-definition-v2-types'
import { workflowBinaryProtocolInstruction } from '../../../shared/workflow-binary-decision-protocol'
import {
  renderWorkflowPromptInstructions,
  type WorkflowPromptHistoryEntry
} from '../../../shared/workflow-prompt-instructions'
import { buildWorkflowV2RoundHistory } from '../../../shared/workflow-v2-graph'

export function renderWorkflowV2StepPrompt(params: {
  definition: WorkflowDefinitionV2
  stepId: string
  goal: string
  workflowName: string
  visit: number
  cycle: number
  history: readonly WorkflowHistoryEntryV2[]
  promptOverride?: { firstVisit?: string; repeatVisit?: string } | null
}): string {
  const step = params.definition.steps.find((candidate) => candidate.id === params.stepId)
  if (!step || (step.kind !== 'agent' && step.kind !== 'decision')) {
    return ''
  }
  const when = params.visit > 1 ? 'repeat-visit' : 'first-visit'
  const override =
    when === 'repeat-visit' ? params.promptOverride?.repeatVisit : params.promptOverride?.firstVisit
  const variant =
    step.prompt.variants.find((candidate) => candidate.when === when) ??
    step.prompt.variants.find((candidate) => candidate.when === 'always')
  if (!variant && !override?.trim()) {
    throw new Error(`No prompt variant for ${params.stepId} (${when})`)
  }
  const roundHistory = buildWorkflowV2RoundHistory(params.history)
  const historyEntries: WorkflowPromptHistoryEntry[] = params.history.map((entry, sequence) => ({
    round: entry.cycle,
    nodeId: entry.stepId,
    output: entry.finalText,
    sequence
  }))
  const body = renderWorkflowPromptInstructions(
    override?.trim() || variant!.template,
    {
      goal: params.goal,
      rootGoal: params.goal,
      criteria: step.prompt.completionCriteria,
      workflowName: params.workflowName,
      nodeName: step.name,
      nodeId: step.id,
      currentRound: String(params.cycle),
      round: String(params.cycle)
    },
    { currentRound: params.cycle, history: historyEntries }
  )
  // Expose structured round history for templates that expand history[n] via renderer.
  void roundHistory
  const protocol = step.kind === 'decision' ? `\n\n${workflowBinaryProtocolInstruction()}` : ''
  return `${body}${protocol}`
}
