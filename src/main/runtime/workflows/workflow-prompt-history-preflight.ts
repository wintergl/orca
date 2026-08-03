import type Database from '../../sqlite/sync-database'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../shared/workflow-definition-access'
import {
  inspectWorkflowPromptInstructions,
  workflowPromptHistoryReferenceRound,
  type WorkflowPromptHistoryEntry
} from '../../../shared/workflow-prompt-instructions'
import { listWorkflowV1PromptHistoryWithLineage } from './workflow-v1-lineage-history'
import { listWorkflowV2HistoryWithLineage } from './workflow-v2-history-store'
import { requireWorkflowDefinitionV1 } from '../../../shared/workflow-definition-access'

export function workflowPromptHistoryPreflightIssues(
  db: Database.Database,
  run: WorkflowRunRecord
): string[] {
  if (isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    const definition = run.templateSnapshot
    const history = listWorkflowV2HistoryWithLineage(db, run)
    const entries = history.map((entry, sequence) => ({
      round: entry.cycle,
      nodeId: entry.stepId,
      output: entry.finalText,
      sequence
    }))
    return definition.steps.flatMap((step) => {
      if (step.kind !== 'agent' && step.kind !== 'decision') {
        return []
      }
      const visit = history.filter((entry) => entry.stepId === step.id).length + 1
      const when = visit > 1 ? 'repeat-visit' : 'first-visit'
      const override = run.promptOverrides?.[step.id]
      const template =
        (when === 'repeat-visit' ? override?.repeatVisit : override?.firstVisit)?.trim() ||
        step.prompt.variants.find((variant) => variant.when === when)?.template ||
        step.prompt.variants.find((variant) => variant.when === 'always')?.template ||
        ''
      return missingReferences(template, Math.max(0, run.lineageCycleBase) + 1, entries, step.id)
    })
  }
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 history preflight')
  const history = listWorkflowV1PromptHistoryWithLineage(db, run.id)
  return definition.nodes.flatMap((node) => {
    if (node.type === 'human-gate' || node.type === 'complete') {
      return []
    }
    const repeated = history.some((entry) => entry.nodeId === node.id)
    const when = repeated ? 'repeat-visit' : 'first-visit'
    const override = run.promptOverrides?.[node.id]
    const template =
      (when === 'repeat-visit' ? override?.repeatVisit : override?.firstVisit)?.trim() ||
      node.promptRules?.rules.find((rule) => rule.when === when)?.template ||
      node.promptRules?.rules.find((rule) => rule.when === 'always')?.template ||
      node.promptInstructions ||
      ''
    return missingReferences(template, Math.max(0, run.lineageCycleBase) + 1, history, node.id)
  })
}

function missingReferences(
  template: string,
  currentRound: number,
  history: readonly WorkflowPromptHistoryEntry[],
  nodeId: string
): string[] {
  return inspectWorkflowPromptInstructions(template).historyReferences.flatMap((reference) => {
    if (reference.round === 'currentRound') {
      return []
    }
    const round = workflowPromptHistoryReferenceRound(reference, currentRound)
    const available = history.some(
      (entry) => entry.round === round && entry.nodeId === reference.nodeId && entry.output.trim()
    )
    return available
      ? []
      : [`${nodeId}: missing history output at cycle ${round}, node ${reference.nodeId}`]
  })
}
