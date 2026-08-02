import { createHash } from 'node:crypto'

/** Controlled attempt diagnostic stored on the failure receipt (not in logs). */
export type WorkflowFailureDiagnosticPayload = {
  rawAgentText: string
  rawAgentTextDigest: string
  rawAgentTextLength: number
  originalLength: number
  originalDigest: string
  truncated: boolean
}

/** Safe fields allowed on WorkflowError.data for ordinary logs. */
export type WorkflowSafeFailureDiagnostics = {
  rawAgentTextDigest: string
  rawAgentTextLength: number
  originalLength: number
  originalDigest: string
  truncated: boolean
}

export const WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS = 4_000_000

export function buildWorkflowFailureDiagnostic(
  rawAgentText: string
): WorkflowFailureDiagnosticPayload | null {
  // Why: originalLength/digest use the exact bytes passed in (no trim) so truncation
  // metadata matches the live response; empty/whitespace-only still yields null.
  if (!rawAgentText.trim()) {
    return null
  }
  const originalDigest = createHash('sha256').update(rawAgentText).digest('hex')
  const truncated = rawAgentText.length > WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS
  const clipped = truncated
    ? rawAgentText.slice(0, WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS)
    : rawAgentText
  return {
    rawAgentText: clipped,
    rawAgentTextDigest: createHash('sha256').update(clipped).digest('hex'),
    rawAgentTextLength: clipped.length,
    originalLength: rawAgentText.length,
    originalDigest,
    truncated
  }
}

export function toSafeFailureDiagnostics(
  diagnostic: WorkflowFailureDiagnosticPayload
): WorkflowSafeFailureDiagnostics {
  return {
    rawAgentTextDigest: diagnostic.rawAgentTextDigest,
    rawAgentTextLength: diagnostic.rawAgentTextLength,
    originalLength: diagnostic.originalLength,
    originalDigest: diagnostic.originalDigest,
    truncated: diagnostic.truncated
  }
}

export function serializeWorkflowFailureDiagnostic(
  payload: WorkflowFailureDiagnosticPayload
): string {
  return JSON.stringify({
    rawAgentText: payload.rawAgentText,
    rawAgentTextDigest: payload.rawAgentTextDigest,
    rawAgentTextLength: payload.rawAgentTextLength,
    originalLength: payload.originalLength,
    originalDigest: payload.originalDigest,
    truncated: payload.truncated
  })
}

export function parseWorkflowFailureDiagnostic(
  raw: string | null | undefined
): WorkflowFailureDiagnosticPayload | null {
  if (!raw) {
    return null
  }
  try {
    const value = JSON.parse(raw) as Partial<WorkflowFailureDiagnosticPayload>
    if (typeof value.rawAgentText !== 'string' || !value.rawAgentText.trim()) {
      return null
    }
    // Stored body is already the controlled clipped form; re-hash it for consistency.
    const body = value.rawAgentText
    const bodyDigest = createHash('sha256').update(body).digest('hex')
    const originalLength =
      typeof value.originalLength === 'number' && value.originalLength >= body.length
        ? value.originalLength
        : body.length
    const originalDigest =
      typeof value.originalDigest === 'string' && value.originalDigest.length > 0
        ? value.originalDigest
        : bodyDigest
    const truncated =
      Boolean(value.truncated) || originalLength > body.length || originalDigest !== bodyDigest
    return {
      rawAgentText: body,
      rawAgentTextDigest: bodyDigest,
      rawAgentTextLength: body.length,
      originalLength,
      originalDigest,
      truncated
    }
  } catch {
    return null
  }
}
