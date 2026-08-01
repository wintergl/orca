import type {
  WorkflowArtifactRevision,
  WorkflowReviewAggregate,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  defaultWorkflowPromptInstructions,
  renderWorkflowPromptInstructions,
  type WorkflowPromptHistoryEntry,
  type WorkflowPromptPlaceholderValues
} from '../../../shared/workflow-prompt-instructions'

export function renderWorkflowNodeInstructions(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): string {
  const node = run.templateSnapshot.nodes.find((candidate) => candidate.id === step.nodeId)
  if (!node || node.type === 'human-gate' || node.type === 'complete') {
    return ''
  }
  const template = selectPromptTemplate(run, step, node)
  const artifact = inputArtifact(run, step)
  const aggregate = reviewAggregate(run, artifact)
  const values: WorkflowPromptPlaceholderValues = {
    goal: run.objective,
    workflowName: `${run.templateName} v${run.templateVersion}`,
    nodeName: step.nodeName,
    nodeId: step.nodeId,
    currentRound: String(step.round),
    round: String(step.round)
  }
  if (node.promptRules) {
    values.criteria = node.promptRules.completionCriteria
  }
  if (node.inputBindings.includes('root-goal')) {
    values.rootGoal = run.objective
  }
  if (node.inputBindings.includes('upstream-completion')) {
    values.upstreamCompletion = upstreamCompletion(run, step, artifact)
  }
  if (node.inputBindings.includes('artifact-revision')) {
    values.artifactRevision = artifact ? formatArtifactRevision(artifact) : undefined
  }
  if (node.inputBindings.includes('review-aggregate')) {
    values.reviewAggregate = aggregate ? formatReviewAggregate(aggregate) : undefined
  }
  if (node.inputBindings.includes('decision')) {
    const decision = aggregate
      ? run.decisions.toReversed().find((candidate) => candidate.reviewAggregateId === aggregate.id)
      : run.decisions.at(-1)
    values.decision = decision ? JSON.stringify(decision, null, 2) : undefined
  }
  values.humanInstructions = humanInstructions(run, aggregate)
  return renderWorkflowPromptInstructions(template, values, {
    currentRound: step.round,
    history: workflowPromptHistory(run, step)
  })
}

function humanInstructions(
  run: WorkflowRunRecord,
  aggregate: WorkflowReviewAggregate | null
): string | undefined {
  if (!aggregate) {
    return undefined
  }
  const decision = run.decisions
    .toReversed()
    .find(
      (candidate) =>
        candidate.source === 'human' &&
        candidate.finalDecision === 'revise' &&
        decisionReviewNodeId(candidate.input) === aggregate.reviewNodeId
    )
  if (!decision?.input || typeof decision.input !== 'object') {
    return undefined
  }
  const value = (decision.input as Record<string, unknown>).humanInstructions
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function decisionReviewNodeId(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const aggregate = (input as Record<string, unknown>).aggregate
  if (!aggregate || typeof aggregate !== 'object') {
    return null
  }
  const reviewNodeId = (aggregate as Record<string, unknown>).reviewNodeId
  return typeof reviewNodeId === 'string' ? reviewNodeId : null
}

function selectPromptTemplate(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  node: NonNullable<WorkflowRunRecord['templateSnapshot']['nodes'][number]>
): string {
  if (!node.promptRules) {
    return (
      node.promptInstructions?.trim() || defaultWorkflowPromptInstructions(node.promptTemplateKey)
    )
  }
  const repeated = run.steps.some(
    (candidate) =>
      candidate.id !== step.id &&
      candidate.nodeId === step.nodeId &&
      candidate.round < step.round &&
      candidate.status === 'succeeded'
  )
  const matchingCondition = repeated ? 'repeat-visit' : 'first-visit'
  const rule =
    node.promptRules.rules.find((candidate) => candidate.when === matchingCondition) ??
    node.promptRules.rules.find((candidate) => candidate.when === 'always')
  if (!rule) {
    throw new Error(`No prompt rule matches ${matchingCondition} for node "${node.id}"`)
  }
  return rule.template
}

function workflowPromptHistory(
  run: WorkflowRunRecord,
  currentStep: WorkflowStepRunRecord
): WorkflowPromptHistoryEntry[] {
  return run.steps.flatMap((step, sequence) =>
    step.id !== currentStep.id && step.status === 'succeeded' && step.conclusionMarkdown
      ? [
          {
            round: step.round,
            nodeId: step.nodeId,
            output: step.conclusionMarkdown,
            sequence
          }
        ]
      : []
  )
}

function inputArtifact(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord
): WorkflowArtifactRevision | null {
  if (step.inputArtifactRevisionId) {
    return run.artifacts.find((candidate) => candidate.id === step.inputArtifactRevisionId) ?? null
  }
  return null
}

function reviewAggregate(
  run: WorkflowRunRecord,
  artifact: WorkflowArtifactRevision | null
): WorkflowReviewAggregate | null {
  return (
    run.reviewAggregates
      .toReversed()
      .find((candidate) => !artifact || candidate.artifactRevisionId === artifact.id) ?? null
  )
}

function upstreamCompletion(
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
  artifact: WorkflowArtifactRevision | null
): string | undefined {
  const producedByArtifact = artifact
    ? run.steps.find((candidate) => candidate.id === artifact.producedByStepRunId)
        ?.conclusionMarkdown
    : null
  if (producedByArtifact) {
    return producedByArtifact
  }
  return (
    run.steps
      .filter((candidate) => candidate.id !== step.id && candidate.conclusionMarkdown)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      ?.conclusionMarkdown ?? undefined
  )
}

function formatArtifactRevision(artifact: WorkflowArtifactRevision): string {
  return `Artifact Revision: ${artifact.id}
Kind: ${artifact.kind}
Digest: ${artifact.digest}
Manifest digest: ${artifact.manifestDigest}
Immutable snapshot: ${artifact.materializedPath ?? 'unavailable'}
Manifest:
${JSON.stringify(artifact.manifest, null, 2)}`
}

function formatReviewAggregate(aggregate: WorkflowReviewAggregate): string {
  return `Review Aggregate: ${aggregate.id}
Outcome: ${aggregate.outcome}
Conflicts:
${JSON.stringify(aggregate.conflicts, null, 2)}

${aggregate.content}`
}
