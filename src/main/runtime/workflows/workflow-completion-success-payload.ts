import type { WorkflowMessageSource } from '../../../shared/workflow-definition-types'
import {
  WorkflowCompletionEnvelopeV1Schema,
  WorkflowDecisionV1Schema,
  WorkflowReviewResultV1Schema
} from '../../../shared/workflow-result-schema'

/** Snapshot required to re-apply Workflow settlement after a crash. */
export type WorkflowSuccessPayload = {
  nodeType: 'produce' | 'review' | 'decide'
  value: unknown
  source: WorkflowMessageSource
  sourceIdentity: string | null
  sourceReference: unknown
  warnings: string[]
  conclusionMarkdown: string
  filesModified: string[]
  artifactRevisionId: string | null
}

export function parseWorkflowSuccessPayload(
  raw: string | null | undefined
): WorkflowSuccessPayload | null {
  if (!raw) {
    return null
  }
  try {
    const value = JSON.parse(raw) as Partial<WorkflowSuccessPayload>
    if (
      value.nodeType !== 'produce' &&
      value.nodeType !== 'review' &&
      value.nodeType !== 'decide'
    ) {
      return null
    }
    if (value.value === undefined || typeof value.source !== 'string') {
      return null
    }
    const payload: WorkflowSuccessPayload = {
      nodeType: value.nodeType,
      value: value.value,
      source: value.source,
      sourceIdentity: value.sourceIdentity ?? null,
      sourceReference: value.sourceReference ?? null,
      warnings: Array.isArray(value.warnings)
        ? value.warnings.filter((item): item is string => typeof item === 'string')
        : [],
      conclusionMarkdown:
        typeof value.conclusionMarkdown === 'string' ? value.conclusionMarkdown : '',
      filesModified: Array.isArray(value.filesModified)
        ? value.filesModified.filter((item): item is string => typeof item === 'string')
        : [],
      artifactRevisionId:
        typeof value.artifactRevisionId === 'string' ? value.artifactRevisionId : null
    }
    return validateWorkflowSuccessPayload(payload)
  } catch {
    return null
  }
}

/** Re-validate envelope shape by node type before recovery settlement. */
export function validateWorkflowSuccessPayload(
  payload: WorkflowSuccessPayload
): WorkflowSuccessPayload | null {
  try {
    if (payload.nodeType === 'produce') {
      payload = { ...payload, value: WorkflowCompletionEnvelopeV1Schema.parse(payload.value) }
    } else if (payload.nodeType === 'review') {
      payload = { ...payload, value: WorkflowReviewResultV1Schema.parse(payload.value) }
    } else {
      payload = { ...payload, value: WorkflowDecisionV1Schema.parse(payload.value) }
    }
    return payload
  } catch {
    return null
  }
}

export function serializeWorkflowSuccessPayload(payload: WorkflowSuccessPayload): string {
  return JSON.stringify(payload)
}

export function buildSuccessPayloadFromPrepared(
  nodeType: 'produce' | 'review' | 'decide',
  prepared: {
    value: unknown
    source: WorkflowMessageSource
    sourceIdentity: string | null
    sourceReference: unknown
    warnings: string[]
    filesModified: string[]
  }
): WorkflowSuccessPayload | null {
  const value = prepared.value
  const conclusionMarkdown =
    value &&
    typeof value === 'object' &&
    'finalConclusionMarkdown' in value &&
    typeof (value as { finalConclusionMarkdown?: unknown }).finalConclusionMarkdown === 'string'
      ? (value as { finalConclusionMarkdown: string }).finalConclusionMarkdown
      : value &&
          typeof value === 'object' &&
          'conclusionMarkdown' in value &&
          typeof (value as { conclusionMarkdown?: unknown }).conclusionMarkdown === 'string'
        ? (value as { conclusionMarkdown: string }).conclusionMarkdown
        : ''
  return validateWorkflowSuccessPayload({
    nodeType,
    value,
    source: prepared.source,
    sourceIdentity: prepared.sourceIdentity,
    sourceReference: prepared.sourceReference,
    warnings: prepared.warnings,
    conclusionMarkdown,
    filesModified: prepared.filesModified,
    artifactRevisionId: null
  })
}
