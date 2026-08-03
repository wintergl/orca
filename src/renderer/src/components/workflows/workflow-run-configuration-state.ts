import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import {
  isWorkflowDefinitionV1,
  isWorkflowRunSnapshotV2
} from '../../../../shared/workflow-definition-access'
import type {
  WorkflowRunPolicyOverrides,
  WorkflowRunPromptOverrides
} from '../../../../shared/workflow-run-lineage'
import { workflowV2RouteCatalog } from '../../../../shared/workflow-v2-route-catalog'

export function effectiveRunPolicy(run: WorkflowRunRecord): WorkflowRunPolicyOverrides {
  if (run.policyOverrides) {
    return run.policyOverrides
  }
  if (isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    return {
      policyVersion: 'v2-route-traversals',
      maxTraversalsByRouteId: Object.fromEntries(
        workflowV2RouteCatalog(run.templateSnapshot)
          .filter((entry) => entry.route.maxTraversals !== undefined)
          .map((entry) => [entry.id, entry.route.maxTraversals!])
      )
    }
  }
  if (!isWorkflowDefinitionV1(run.templateSnapshot)) {
    return { policyVersion: 'v1-review-rounds', maxReviewRoundsByNodeId: {} }
  }
  return {
    policyVersion: 'v1-review-rounds',
    maxReviewRoundsByNodeId: Object.fromEntries(
      run.templateSnapshot.nodes
        .filter((node) => node.type === 'review')
        .map((node) => [node.id, node.reviewPolicy.maxReviewRounds])
    )
  }
}

export function effectivePromptOverrides(run: WorkflowRunRecord): WorkflowRunPromptOverrides {
  return structuredClone(run.promptOverrides ?? {})
}

export function runPolicyOverrideForSave(
  run: WorkflowRunRecord,
  policy: WorkflowRunPolicyOverrides
): WorkflowRunPolicyOverrides | null {
  if (run.policyOverrides) {
    return policy
  }
  return JSON.stringify(policy) === JSON.stringify(effectiveRunPolicy(run)) ? null : policy
}

export function runPromptOverridesForSave(
  prompts: WorkflowRunPromptOverrides
): WorkflowRunPromptOverrides | null {
  return Object.keys(prompts).length > 0 ? prompts : null
}

export function runConfigurationChanged(
  run: WorkflowRunRecord,
  objective: string,
  policy: WorkflowRunPolicyOverrides,
  prompts: WorkflowRunPromptOverrides
): boolean {
  return (
    objective !== run.objective ||
    JSON.stringify(policy) !== JSON.stringify(effectiveRunPolicy(run)) ||
    JSON.stringify(prompts) !== JSON.stringify(effectivePromptOverrides(run))
  )
}
