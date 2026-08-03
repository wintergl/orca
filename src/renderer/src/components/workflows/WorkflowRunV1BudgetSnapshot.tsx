import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { isWorkflowDefinitionV1 } from '../../../../shared/workflow-definition-access'
import { translate } from '@/i18n/i18n'

export function WorkflowRunV1BudgetSnapshot({
  run
}: {
  run: WorkflowRunRecord
}): React.JSX.Element | null {
  if (!isWorkflowDefinitionV1(run.templateSnapshot)) {
    return null
  }
  const reviews = run.templateSnapshot.nodes.filter((node) => node.type === 'review')
  if (reviews.length === 0) {
    return null
  }
  const overrides =
    run.policyOverrides?.policyVersion === 'v1-review-rounds'
      ? run.policyOverrides.maxReviewRoundsByNodeId
      : {}
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 text-sm font-medium">
        {translate('workflows.run.reviewBudgets', 'Review round budgets')}
      </h3>
      <div className="divide-y divide-border">
        {reviews.map((review) => {
          const templateLimit = review.reviewPolicy.maxReviewRounds
          const override = overrides[review.id]
          const extension = run.reviewRoundExtensionsByNodeId[review.id] ?? 0
          const used = run.reviewRoundsByNodeId[review.id] ?? 0
          const effective = (override ?? templateLimit) + extension
          return (
            <div
              key={review.id}
              className="grid gap-1 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{review.name}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{review.id}</p>
              </div>
              <p className="text-muted-foreground">
                {translate(
                  'workflows.run.reviewBudgetAudit',
                  'template {{template}} · override {{override}} · extension +{{extension}} · used {{used}} / {{effective}}',
                  {
                    template: templateLimit,
                    override: override ?? 'none',
                    extension,
                    used,
                    effective
                  }
                )}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
