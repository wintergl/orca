import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { isWorkflowRunSnapshotV2 } from '../../../../shared/workflow-definition-access'
import { workflowV2RouteCatalog } from '../../../../shared/workflow-v2-route-catalog'
import { translate } from '@/i18n/i18n'

export function WorkflowRunV2BudgetSnapshot({
  run
}: {
  run: WorkflowRunRecord
}): React.JSX.Element | null {
  if (!isWorkflowRunSnapshotV2(run.templateSnapshot)) {
    return null
  }
  const overrides =
    run.policyOverrides?.policyVersion === 'v2-route-traversals'
      ? run.policyOverrides.maxTraversalsByRouteId
      : {}
  const rows = workflowV2RouteCatalog(run.templateSnapshot)
    .map((entry) => {
      const templateLimit = entry.route.maxTraversals
      const override = overrides[entry.id]
      const extension = run.v2RouteBudgetExtensions?.[entry.id] ?? 0
      const used = run.v2RouteTraversals?.[entry.id] ?? 0
      const base = override ?? templateLimit
      const effective = base === undefined ? null : base + extension
      return { ...entry, templateLimit, override, extension, used, effective }
    })
    .filter((row) => row.templateLimit !== undefined || row.override !== undefined || row.extension)
  if (rows.length === 0) {
    return null
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 text-sm font-medium">
        {translate('workflows.run.routeBudgets', 'Route traversal budgets')}
      </h3>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid gap-1 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.sourceStepName} · {row.label}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">{row.id}</p>
            </div>
            <p className="text-muted-foreground">
              {translate(
                'workflows.run.routeBudgetAudit',
                'template {{template}} · override {{override}} · extension +{{extension}} · used {{used}} / {{effective}}',
                {
                  template: row.templateLimit ?? '∞',
                  override: row.override ?? 'none',
                  extension: row.extension,
                  used: row.used,
                  effective: row.effective ?? '∞'
                }
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
