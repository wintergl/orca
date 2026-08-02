import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { MessageRow } from '../orchestration/types'
import type { OrcaRuntimeService } from '../orca-runtime'
import type {
  WorkflowCompletionEnvelopeV1,
  WorkflowDecisionV1,
  WorkflowReviewResultV1
} from '../../../shared/workflow-result-schema'
import type {
  WorkflowMessageSource,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { parseWorkflowCompletionJsonText } from './workflow-completion-json-parse'
import { WorkflowError } from './workflow-error'
import { normalizeWorkflowResult } from './workflow-result-normalization'
import { readWorkflowAgentFinalResponse } from './workflow-agent-final-response'

const MAX_REPORT_BYTES = 5 * 1024 * 1024

export type WorkflowCollectedResult<T> = {
  value: T
  source: WorkflowMessageSource
  digest: string
  sourceIdentity: string | null
  sourceReference: unknown
  warnings: string[]
  workerDone: MessageRow
  filesModified: string[]
}

export async function collectWorkflowResult(params: {
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  expectedReportPath: string
}): Promise<
  WorkflowCollectedResult<
    WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1
  >
> {
  const assignment = params.step.assignment
  if (
    !assignment ||
    !params.run.orchestrationRunId ||
    !params.step.taskId ||
    !params.step.dispatchId
  ) {
    throw incomplete('Workflow Step completion identity is incomplete.')
  }
  const db = params.runtime.getOrchestrationDb()
  const workerDone = findWorkerDone(
    db.getRunMailboxHistory(params.run.orchestrationRunId, 500, ['worker_done']),
    params.step.taskId,
    params.step.dispatchId
  )
  if (!workerDone) {
    throw incomplete('The authoritative worker_done signal is missing.')
  }
  const payload = parsePayload(workerDone)
  if (payload.outcome !== 'succeeded') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'The Agent reported a failed outcome.'
    )
  }
  const reportPath = typeof payload.reportPath === 'string' ? payload.reportPath : null
  const result = reportPath
    ? await readWorkflowResultReport({
        reportedPath: reportPath,
        expectedReportPath: params.expectedReportPath,
        run: params.run,
        step: params.step
      })
    : await readTranscriptFallback(params.runtime, params.step)
  const value =
    result.source === 'report-path'
      ? result.value
      : normalizeWorkflowResult(result.value, params.run, params.step)
  return {
    value,
    source: result.source,
    digest: sha256(result.raw),
    sourceIdentity: result.sourceIdentity,
    sourceReference: {
      workerDoneMessageId: workerDone.id,
      reportPath: result.source === 'report-path' ? params.expectedReportPath : null,
      transcript: result.sourceIdentity
    },
    warnings: result.warnings,
    workerDone,
    filesModified: Array.isArray(payload.filesModified)
      ? payload.filesModified.filter((value): value is string => typeof value === 'string')
      : []
  }
}

export async function readWorkflowResultReport(params: {
  reportedPath: string
  expectedReportPath: string
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): Promise<{
  value: WorkflowCompletionEnvelopeV1 | WorkflowReviewResultV1 | WorkflowDecisionV1
  raw: Buffer
  source: 'report-path'
  sourceIdentity: string
  warnings: string[]
}> {
  const result = await readReportPath(params.reportedPath, params.expectedReportPath)
  return {
    ...result,
    value: normalizeWorkflowResult(result.value, params.run, params.step)
  }
}

async function readReportPath(
  reportedPath: string,
  expectedReportPath: string
): Promise<{
  value: unknown
  raw: Buffer
  source: 'report-path'
  sourceIdentity: string
  warnings: string[]
}> {
  let raw: Buffer
  let reportedReal: string
  try {
    const reported = resolve(reportedPath)
    const expected = resolve(expectedReportPath)
    if (reported !== expected) {
      throw incomplete('reportPath is outside the Engine-approved location.')
    }
    const directStat = await lstat(reported)
    if (!directStat.isFile() || directStat.isSymbolicLink() || directStat.size > MAX_REPORT_BYTES) {
      throw incomplete('reportPath is not a supported regular JSON file.')
    }
    const resolved = await Promise.all([
      realpath(reported),
      realpath(expected).catch(() => expected)
    ])
    reportedReal = resolved[0]!
    if (reportedReal !== resolved[1]) {
      throw incomplete('reportPath resolved to a different file.')
    }
    const reportStat = await lstat(reportedReal)
    if (!reportStat.isFile() || reportStat.size > MAX_REPORT_BYTES) {
      throw incomplete('reportPath is not a supported regular JSON file.')
    }
    raw = await readFile(reportedReal)
  } catch (error) {
    if (error instanceof WorkflowError) {
      throw error
    }
    throw incomplete('reportPath is missing or unreadable.', error)
  }
  const text = raw.toString('utf8')
  return {
    value: parseWorkflowCompletionJsonText(text, 'reportPath contains invalid JSON.'),
    raw,
    source: 'report-path',
    sourceIdentity: `report-path:${sha256(Buffer.from(reportedReal))}`,
    warnings: []
  }
}

async function readTranscriptFallback(
  runtime: OrcaRuntimeService,
  step: WorkflowStepRunRecord
): Promise<{
  value: unknown
  raw: Buffer
  source: 'transcript'
  sourceIdentity: string
  warnings: string[]
}> {
  const finalResponse = await readWorkflowAgentFinalResponse(runtime, step)
  if (!finalResponse) {
    throw incomplete('The Worker transcript has no final Assistant response for this Step.')
  }
  const { text, sourceIdentity } = finalResponse
  const raw = Buffer.from(text)
  return {
    value: parseWorkflowCompletionJsonText(text, 'The final Assistant message is not exact JSON.'),
    raw,
    source: 'transcript',
    sourceIdentity,
    warnings: []
  }
}

function findWorkerDone(
  messages: MessageRow[],
  taskId: string,
  dispatchId: string
): MessageRow | null {
  return (
    messages.find((message) => {
      const payload = parsePayload(message)
      return payload.taskId === taskId && payload.dispatchId === dispatchId
    }) ?? null
  )
}

function parsePayload(message: MessageRow): Record<string, unknown> {
  try {
    const value = JSON.parse(message.payload ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function incomplete(message: string, data?: unknown): WorkflowError {
  return new WorkflowError('workflow_completion_incomplete', message, data)
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
