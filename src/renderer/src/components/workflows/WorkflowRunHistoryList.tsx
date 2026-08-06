import type {
  WorkflowRunRecord,
  WorkflowRunSummary
} from '../../../../shared/workflow-definition-types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { workflowRunStatusLabel } from './workflow-runtime-state-labels'

export function WorkflowRunHistoryList({
  runs,
  selectedRun,
  onOpenRun
}: {
  runs: WorkflowRunSummary[]
  selectedRun: WorkflowRunRecord | null
  onOpenRun: (run: WorkflowRunSummary) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3 p-2">
      {groupByRoot(runs).map((group) => (
        <section key={group.rootRunId}>
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground">
            <span>
              {translate('workflows.history.lineage', 'Lineage')} · {group.rootRunId.slice(-8)}
            </span>
            <span>{group.runs.length}</span>
          </div>
          <div className="space-y-1 border-l border-border pl-1.5">
            {group.runs.map((run, index) => (
              <button
                type="button"
                key={run.id}
                data-current={selectedRun?.id === run.id}
                className={cn(
                  'w-full rounded-md px-2 py-2 text-left hover:bg-accent',
                  selectedRun?.id === run.id && 'bg-accent'
                )}
                onClick={() => onOpenRun(run)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{run.templateName}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                      {run.objective || run.id}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {index === 0
                        ? translate('workflows.history.rootRun', 'Root Run')
                        : translate(
                            'workflows.history.anotherRoundNumber',
                            'Another round {{count}}',
                            {
                              count: index
                            }
                          )}
                    </span>
                    {run.policyOverrideVersion || (run.promptOverrideNodeIds?.length ?? 0) > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {run.policyOverrideVersion ? (
                          <Badge variant="secondary" className="text-[9px]">
                            {translate('workflows.history.runPolicy', 'Run policy')}
                          </Badge>
                        ) : null}
                        {(run.promptOverrideNodeIds?.length ?? 0) > 0 ? (
                          <Badge variant="secondary" className="text-[9px]">
                            {translate('workflows.history.promptOverrides', 'Prompt overrides')} ·{' '}
                            {run.promptOverrideNodeIds?.length}
                          </Badge>
                        ) : null}
                      </span>
                    ) : null}
                    {run.failureCode ? (
                      <span className="mt-1 block text-[10px] text-destructive">
                        {run.failureCode}
                      </span>
                    ) : null}
                    {run.businessBudgetSummary ? (
                      <span className="mt-1 line-clamp-2 block text-[10px] text-muted-foreground">
                        {run.businessBudgetSummary}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {workflowRunStatusLabel(run.status)}
                  </Badge>
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {formatTimestamp(run.startedAt ?? run.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function groupByRoot(
  runs: WorkflowRunSummary[]
): { rootRunId: string; runs: WorkflowRunSummary[] }[] {
  const groups = new Map<string, WorkflowRunSummary[]>()
  for (const run of runs) {
    const group = groups.get(run.rootRunId) ?? []
    group.push(run)
    groups.set(run.rootRunId, group)
  }
  return [...groups]
    .map(([rootRunId, entries]) => ({
      rootRunId,
      runs: entries.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    }))
    .toSorted((left, right) =>
      right.runs.at(-1)!.createdAt.localeCompare(left.runs.at(-1)!.createdAt)
    )
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
