import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  WorkflowArtifactRevision,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { workflowDecisionProtocolInstruction } from '../../../shared/workflow-decision-protocol'
import { renderWorkflowNodeInstructions } from './workflow-prompt-context'

export async function workflowReportPath(runId: string, stepRunId: string): Promise<string> {
  const directory = join(tmpdir(), 'orca-workflow-reports', runId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return join(directory, `${stepRunId}.json`)
}

export function buildProducePrompt(params: {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): string {
  const nodeInstructions = renderWorkflowNodeInstructions(params.run, params.step)
  return `${nodeInstructions}

请只完成当前“${params.step.nodeName}”步骤，不启动后续节点。完成后直接返回完整结果。`
}

export function buildDecisionPrompt(params: {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): string {
  const nodeInstructions = renderWorkflowNodeInstructions(params.run, params.step)
  return `${nodeInstructions}

请只完成当前“${params.step.nodeName}”步骤。${workflowDecisionProtocolInstruction('decision')}完成后直接返回完整结论。`
}

export function buildReviewPrompt(params: {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  artifact: WorkflowArtifactRevision
}): string {
  const nodeInstructions = renderWorkflowNodeInstructions(params.run, params.step)
  return `${nodeInstructions}

请只完成当前“${params.step.nodeName}”步骤，只评审冻结产物 ${params.artifact.id}（${params.artifact.materializedPath ?? 'unavailable'}），不要修改实现工作区或冻结快照。${workflowDecisionProtocolInstruction('review')}完成后直接返回完整评审结论。`
}
