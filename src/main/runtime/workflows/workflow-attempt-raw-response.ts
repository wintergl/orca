import { WorkflowError } from './workflow-error'
import {
  buildWorkflowFailureDiagnostic,
  toSafeFailureDiagnostics,
  type WorkflowFailureDiagnosticPayload
} from './workflow-completion-failure-diagnostic'

/**
 * Side-channel for controlled diagnostics: never put the body (or Error.cause
 * messages that embed input fragments) on WorkflowError.data.
 * Receipt storage is durable; this WeakMap only bridges live throw → failStep.
 */
const diagnosticByError = new WeakMap<object, WorkflowFailureDiagnosticPayload>()

/** Build incomplete error with log-safe diagnostics only. */
export function workflowIncompleteWithRawAgentText(
  message: string,
  rawAgentText: string
): WorkflowError {
  const diagnostic = buildWorkflowFailureDiagnostic(rawAgentText)
  const error = new WorkflowError(
    'workflow_completion_incomplete',
    message,
    diagnostic ? toSafeFailureDiagnostics(diagnostic) : undefined
  )
  if (diagnostic) {
    diagnosticByError.set(error, diagnostic)
  }
  return error
}

/** Live-path raw text (WeakMap), never from Error.data body. */
export function takeWorkflowRawAgentText(error: unknown): string | null {
  return failureDiagnosticFromError(error)?.rawAgentText ?? null
}

/** Full controlled payload for receipt persistence (includes truncation metadata). */
export function failureDiagnosticFromError(
  error: unknown
): WorkflowFailureDiagnosticPayload | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  return diagnosticByError.get(error) ?? null
}
