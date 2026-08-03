import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../../shared/workflow-definition-access'
import type { WorkflowRunPolicyOverrides } from '../../../../shared/workflow-run-lineage'
import { workflowV2RouteCatalog } from '../../../../shared/workflow-v2-route-catalog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

export function WorkflowRunPolicyConfiguration({
  run,
  value,
  onChange
}: {
  run: WorkflowRunRecord
  value: WorkflowRunPolicyOverrides
  onChange: (value: WorkflowRunPolicyOverrides) => void
}): React.JSX.Element {
  const fields = policyFields(run, value)
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">
          {translate('workflows.application.runBudget', 'Run budget')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {translate(
            'workflows.application.runBudgetHint',
            'These limits apply only to this run and are frozen when it starts.'
          )}
        </p>
      </div>
      {fields.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.id} className="space-y-1">
              <span className="text-[11px] font-medium">{field.label}</span>
              <Input
                type="number"
                min={field.min}
                max={field.max}
                value={field.value}
                onChange={(event) => field.update(Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate('workflows.application.noRunBudgets', 'This workflow has no bounded routes.')}
        </p>
      )}
    </section>
  )

  function policyFields(
    currentRun: WorkflowRunRecord,
    current: WorkflowRunPolicyOverrides
  ): PolicyField[] {
    if (
      isWorkflowRunSnapshotV2(currentRun.templateSnapshot) &&
      current.policyVersion === 'v2-route-traversals'
    ) {
      return workflowV2RouteCatalog(currentRun.templateSnapshot)
        .filter(
          (entry) =>
            entry.route.maxTraversals !== undefined ||
            current.maxTraversalsByRouteId[entry.id] !== undefined
        )
        .map((entry) => ({
          id: entry.id,
          label: `${entry.sourceStepName} · ${entry.label}`,
          value: current.maxTraversalsByRouteId[entry.id] ?? entry.route.maxTraversals ?? 0,
          min: 0,
          max: 50,
          update: (next) =>
            onChange({
              ...current,
              maxTraversalsByRouteId: {
                ...current.maxTraversalsByRouteId,
                [entry.id]: clamp(next, 0, 50)
              }
            })
        }))
    }
    if (!isWorkflowRunSnapshotV2(currentRun.templateSnapshot)) {
      const v1 =
        current.policyVersion === 'v1-review-rounds'
          ? current
          : { policyVersion: 'v1-review-rounds' as const, maxReviewRoundsByNodeId: {} }
      return currentRun.templateSnapshot.nodes
        .filter((node) => node.type === 'review')
        .map((node) => ({
          id: node.id,
          label: node.name,
          value: v1.maxReviewRoundsByNodeId[node.id] ?? node.reviewPolicy.maxReviewRounds,
          min: 1,
          max: 20,
          update: (next) =>
            onChange({
              ...v1,
              maxReviewRoundsByNodeId: {
                ...v1.maxReviewRoundsByNodeId,
                [node.id]: clamp(next, 1, 20)
              }
            })
        }))
    }
    return []
  }
}

type PolicyField = {
  id: string
  label: string
  value: number
  min: number
  max: number
  update: (value: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
}
