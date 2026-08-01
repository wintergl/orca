import { describe, expect, it } from 'vitest'
import { workflowDefinitionV1Schema } from './workflow-definition-schema'
import { BUILTIN_WORKFLOW_TEMPLATES } from './workflow-fixtures'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('WorkflowDefinitionV1', () => {
  it('validates and snapshots every complete built-in fixture', () => {
    expect(BUILTIN_WORKFLOW_TEMPLATES).toHaveLength(3)
    for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
      expect(workflowDefinitionV1Schema.parse(template.definition)).toEqual(template.definition)
    }
    expect(BUILTIN_WORKFLOW_TEMPLATES).toMatchSnapshot()
  })

  it('rejects missing fields, unknown fields, unknown prompts, and schema upgrades', () => {
    const source = BUILTIN_WORKFLOW_TEMPLATES[0]!.definition
    expect(
      workflowDefinitionV1Schema.safeParse({ ...clone(source), schemaVersion: 2 }).success
    ).toBe(false)
    expect(
      workflowDefinitionV1Schema.safeParse({ ...clone(source), futureSetting: true }).success
    ).toBe(false)

    const missingPolicy = clone(source)
    const review = missingPolicy.nodes.find((node) => node.type === 'review')
    if (review?.type === 'review') {
      delete (review.reviewPolicy as Partial<typeof review.reviewPolicy>).timeoutMs
    }
    expect(workflowDefinitionV1Schema.safeParse(missingPolicy).success).toBe(false)

    const unknownPrompt = clone(source)
    unknownPrompt.nodes[0]!.promptTemplateKey = 'builtin.unknown.v1' as never
    expect(workflowDefinitionV1Schema.safeParse(unknownPrompt).success).toBe(false)
  })

  it('rejects unknown, unclosed, and unbound prompt placeholders', () => {
    const unknown = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    unknown.nodes[0]!.promptInstructions = 'Do {{unknownThing}}'
    expect(workflowDefinitionV1Schema.safeParse(unknown).success).toBe(false)

    const unclosed = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    unclosed.nodes[0]!.promptInstructions = 'Do {{rootGoal'
    expect(workflowDefinitionV1Schema.safeParse(unclosed).success).toBe(false)

    const unbound = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    unbound.nodes[0]!.promptInstructions = 'Review {{artifactRevision}}'
    expect(workflowDefinitionV1Schema.safeParse(unbound).success).toBe(false)
  })

  it('keeps V1 definitions without prompt instructions readable', () => {
    const legacy = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    for (const node of legacy.nodes) {
      delete node.promptInstructions
    }
    expect(workflowDefinitionV1Schema.safeParse(legacy).success).toBe(true)
  })

  it('keeps retry attempts separate from review rounds and accepts no timeout', () => {
    const source = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    const review = source.nodes.find((node) => node.type === 'review')
    expect(review?.type).toBe('review')
    if (review?.type !== 'review') {
      return
    }
    review.retryPolicy.maxAttempts = 1
    review.reviewPolicy.maxReviewRounds = 7
    review.reviewPolicy.timeoutMs = null
    expect(workflowDefinitionV1Schema.parse(source)).toEqual(source)
  })

  it('rejects invalid transitions and unbounded revision loops', () => {
    const source = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    source.transitions[0]!.to = 'missing-node'
    expect(workflowDefinitionV1Schema.safeParse(source).success).toBe(false)

    const unbounded = clone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    const reviewExit = unbounded.transitions.find((transition) => transition.from === 'spec-review')
    if (reviewExit) {
      reviewExit.to = 'complete'
    }
    expect(workflowDefinitionV1Schema.safeParse(unbounded).success).toBe(false)
  })
})

describe('built-in workflow reachability', () => {
  const full = BUILTIN_WORKFLOW_TEMPLATES.find(
    (template) => template.id === 'builtin.spec-to-code-review.v1'
  )!
  const target = (transitionId: string): string | undefined =>
    full.definition.transitions.find((transition) => transition.id === transitionId)?.to

  it('enters implementation only after SPEC approval', () => {
    expect(target('spec-decision-approved')).toBe('code-produce')
    expect(target('spec-human-approved')).toBe('code-produce')
    expect(full.definition.transitions).not.toContainEqual(
      expect.objectContaining({ from: 'spec-decide', to: 'complete' })
    )
  })

  it('keeps code revision inside the code stage', () => {
    expect(target('code-decision-revise')).toBe('code-produce')
    expect(target('code-human-revise')).toBe('code-produce')
  })

  it('bounds each review independently and never bypasses human gates', () => {
    const reviews = full.definition.nodes.filter((node) => node.type === 'review')
    expect(reviews.map((node) => [node.id, node.reviewPolicy.maxReviewRounds])).toEqual([
      ['spec-review', 3],
      ['code-review', 3]
    ])
    expect(target('spec-decision-human')).toBe('spec-human')
    expect(target('code-decision-human')).toBe('code-human')
  })
})
