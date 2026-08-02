import { describe, expect, it } from 'vitest'
import {
  failureDiagnosticFromError,
  workflowIncompleteWithRawAgentText
} from './workflow-attempt-raw-response'
import {
  buildWorkflowFailureDiagnostic,
  parseWorkflowFailureDiagnostic,
  serializeWorkflowFailureDiagnostic,
  WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS
} from './workflow-completion-failure-diagnostic'

describe('workflow failure diagnostic payload', () => {
  it('records truncation metadata when the raw body exceeds the storage cap', () => {
    const raw = `${'a'.repeat(WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS + 12)}tail`
    const diagnostic = buildWorkflowFailureDiagnostic(raw)
    expect(diagnostic).toMatchObject({
      truncated: true,
      rawAgentTextLength: WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS,
      originalLength: raw.length
    })
    expect(diagnostic!.rawAgentText).toHaveLength(WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS)
    expect(diagnostic!.rawAgentTextDigest).not.toBe(diagnostic!.originalDigest)
    const roundTrip = parseWorkflowFailureDiagnostic(
      serializeWorkflowFailureDiagnostic(diagnostic!)
    )
    expect(roundTrip).toMatchObject({
      truncated: true,
      originalLength: raw.length,
      originalDigest: diagnostic!.originalDigest,
      rawAgentTextLength: WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS
    })
  })

  it('preserves truncation metadata through the live error → receipt diagnostic path', () => {
    const raw = `${'b'.repeat(WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS + 7)}END`
    const error = workflowIncompleteWithRawAgentText('invalid decision protocol', raw)
    const fromError = failureDiagnosticFromError(error)
    expect(fromError).toMatchObject({
      truncated: true,
      originalLength: raw.length,
      rawAgentTextLength: WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS
    })
    expect(fromError!.originalDigest).not.toBe(fromError!.rawAgentTextDigest)
    expect(error.data).toMatchObject({
      truncated: true,
      originalLength: raw.length,
      rawAgentTextLength: WORKFLOW_RAW_AGENT_TEXT_MAX_CHARS
    })
  })
})
