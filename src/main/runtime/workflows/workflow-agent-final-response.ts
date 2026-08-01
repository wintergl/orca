import type { NativeChatMessage } from '../../../shared/native-chat-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import { inspectWorkerTerminal } from '../rpc/methods/orchestration-worker-observation'
import { readExactWorkerOutput } from '../rpc/methods/orchestration-worker-output'
import type { WorkflowStepRunRecord } from '../../../shared/workflow-definition-types'
import { assertWorkflowAgentLifecycle } from './workflow-agent-lifecycle-authority'
import { WorkflowError } from './workflow-error'

const MAX_TRANSCRIPT_PAGES = 200

export async function readWorkflowAgentFinalResponse(
  runtime: OrcaRuntimeService,
  step: WorkflowStepRunRecord
): Promise<{ text: string; sourceIdentity: string } | null> {
  const db = runtime.getOrchestrationDb()
  const worker = step.dispatchId ? db.getWorkerDispatch(step.dispatchId) : undefined
  if (!worker?.agent_terminal_handle || !step.dispatchId || !step.assignment) {
    throw incomplete('The exact Worker transcript is unavailable.')
  }
  const observation = await inspectWorkerTerminal(runtime, db, step.dispatchId)
  if (!observation.exact) {
    throw incomplete('The Worker identity changed before transcript collection.')
  }
  const providerSessionId = assertWorkflowAgentLifecycle(
    runtime,
    step.assignment,
    worker.agent_terminal_handle
  )
  const exactSession = runtime.getExactWorkerProviderSession(
    worker.agent_terminal_handle,
    timestampMs(worker.created_at)
  )
  if (!exactSession || exactSession.providerSession.id !== providerSessionId) {
    throw incomplete('The Provider Session does not match the Step assignment.')
  }
  const transcript = await readCompleteTranscript({
    runtime,
    dispatchId: step.dispatchId,
    terminalHandle: worker.agent_terminal_handle,
    workerState: worker.state,
    terminalStatus: observation.status === 'exited' ? 'exited' : 'running',
    attachedAt: worker.created_at
  })
  const text = extractWorkflowAgentFinalResponse(transcript.messages, step.prompt)
  return text ? { text, sourceIdentity: transcript.sourceIdentity } : null
}

export function extractWorkflowAgentFinalResponse(
  messages: readonly NativeChatMessage[],
  prompt: string
): string | null {
  const expected = normalizePrompt(prompt)
  const promptIndex = messages.findLastIndex(
    (message) => message.role === 'user' && normalizePrompt(messageText(message)).includes(expected)
  )
  if (promptIndex < 0) {
    return null
  }
  const response = messages
    .slice(promptIndex + 1)
    .toReversed()
    .find((message) => message.role === 'assistant')
  return response ? messageText(response).trim() || null : null
}

function messageText(message: NativeChatMessage): string {
  return message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function normalizePrompt(value: string): string {
  return value.replaceAll('\r\n', '\n').trim()
}

async function readCompleteTranscript(
  args: Omit<Parameters<typeof readExactWorkerOutput>[0], 'source' | 'cursor' | 'limit'>
): Promise<{ messages: NativeChatMessage[]; sourceIdentity: string }> {
  const messages: NativeChatMessage[] = []
  let cursor: string | undefined
  let sourceIdentity: string | null = null
  for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
    const output = await readExactWorkerOutput({
      ...args,
      source: 'transcript',
      cursor,
      limit: 50,
      startAtBeginning: cursor === undefined
    })
    if (output.source !== 'transcript' || output.warnings.length > 0) {
      throw incomplete('The Worker transcript is clipped, incomplete, or has warnings.')
    }
    sourceIdentity ??= output.sourceIdentity
    if (output.sourceIdentity !== sourceIdentity) {
      throw incomplete('The Worker transcript source changed during pagination.')
    }
    messages.push(...output.transcript.messages)
    if (!output.transcript.limited) {
      return { messages, sourceIdentity }
    }
    if (!output.cursor || output.cursor === cursor) {
      throw incomplete('The Worker transcript cursor did not advance.')
    }
    cursor = output.cursor
  }
  throw incomplete('The Worker transcript exceeded the bounded pagination limit.')
}

function timestampMs(value: string): number {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function incomplete(message: string): WorkflowError {
  return new WorkflowError('workflow_completion_incomplete', message)
}
