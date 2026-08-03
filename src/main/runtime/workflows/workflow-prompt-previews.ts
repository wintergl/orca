import type Database from '../../sqlite/sync-database'
import type {
  WorkflowPromptPreview,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  isWorkflowRunSnapshotV2,
  requireWorkflowDefinitionV1,
  requireWorkflowDefinitionV2
} from '../../../shared/workflow-definition-access'
import { listWorkflowV2HistoryWithLineage } from './workflow-v2-history-store'
import { renderWorkflowV2StepPrompt } from './workflow-v2-prompt'
import { renderWorkflowNodeInstructions } from './workflow-prompt-context'

export function buildWorkflowPromptPreviews(
  db: Database.Database,
  run: WorkflowRunRecord
): WorkflowPromptPreview[] {
  return isWorkflowRunSnapshotV2(run.templateSnapshot)
    ? buildV2Previews(db, run)
    : buildV1Previews(db, run)
}

function buildV2Previews(db: Database.Database, run: WorkflowRunRecord): WorkflowPromptPreview[] {
  const definition = requireWorkflowDefinitionV2(run.templateSnapshot, 'V2 prompt preview')
  const history = listWorkflowV2HistoryWithLineage(db, run)
  const cycle = Math.max(1, run.lineageCycleBase + 1)
  return definition.steps.flatMap((step) => {
    if (step.kind !== 'agent' && step.kind !== 'decision') {
      return []
    }
    const common = {
      definition,
      stepId: step.id,
      goal: run.objective,
      workflowName: `${run.templateName} v${run.templateVersion}`,
      cycle,
      history,
      promptOverride: run.promptOverrides?.[step.id]
    }
    return [
      {
        nodeId: step.id,
        nodeName: step.name,
        firstVisit: renderPreview(() => renderWorkflowV2StepPrompt({ ...common, visit: 1 })),
        repeatVisit: renderPreview(() => renderWorkflowV2StepPrompt({ ...common, visit: 2 }))
      }
    ]
  })
}

function buildV1Previews(db: Database.Database, run: WorkflowRunRecord): WorkflowPromptPreview[] {
  const definition = requireWorkflowDefinitionV1(run.templateSnapshot, 'V1 prompt preview')
  return definition.nodes.flatMap((node) => {
    if (node.type === 'human-gate' || node.type === 'complete') {
      return []
    }
    const step = syntheticPreviewStep(run, node.id, node.name, node.type)
    return [
      {
        nodeId: node.id,
        nodeName: node.name,
        firstVisit: renderPreview(() =>
          renderWorkflowNodeInstructions({ ...run, lineageCycleBase: 0, steps: [] }, step, db)
        ),
        repeatVisit: renderPreview(() =>
          renderWorkflowNodeInstructions(
            { ...run, lineageCycleBase: Math.max(1, run.lineageCycleBase), steps: [] },
            step,
            db
          )
        )
      }
    ]
  })
}

function renderPreview(render: () => string): string {
  try {
    return render()
  } catch (error) {
    return `[Preview unavailable: ${error instanceof Error ? error.message : String(error)}]`
  }
}

function syntheticPreviewStep(
  run: WorkflowRunRecord,
  nodeId: string,
  nodeName: string,
  nodeType: WorkflowStepRunRecord['nodeType']
): WorkflowStepRunRecord {
  return {
    id: `workflow_prompt_preview_${nodeId}`,
    runId: run.id,
    nodeId,
    nodeName,
    nodeType,
    round: 1,
    attempt: 1,
    status: 'queued',
    assignment: null,
    orchestrationRunId: null,
    taskId: null,
    dispatchId: null,
    deliveryId: `workflow_prompt_preview_${nodeId}`,
    deliveryState: 'prepared',
    prompt: '',
    conclusionMarkdown: null,
    resultEnvelope: null,
    messageSource: null,
    messageDigest: null,
    sourceIdentity: null,
    sourceWarnings: [],
    inputArtifactRevisionId: null,
    outputArtifactRevisionId: null,
    errorCode: null,
    errorMessage: null,
    recovery: null,
    startedAt: null,
    completedAt: null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}
