import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function WorkflowRunConfigurationSnapshot({
  run
}: {
  run: WorkflowRunRecord
}): React.JSX.Element {
  const localCycle = Math.max(1, ...run.steps.map((step) => step.round), 1)
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">
        {translate('workflows.run.configurationSnapshot', 'Run configuration snapshot')}
      </h3>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <SnapshotValue
          label={translate('workflows.run.rootRun', 'Root Run')}
          value={run.rootRunId}
        />
        <SnapshotValue
          label={translate('workflows.run.parentRun', 'Parent Run')}
          value={run.parentRunId ?? 'none'}
        />
        <SnapshotValue
          label={translate('workflows.run.localCycle', 'Local Run cycle')}
          value={String(localCycle)}
        />
        <SnapshotValue
          label={translate('workflows.run.lineageCycle', 'Lineage cycle')}
          value={String(run.lineageCycleBase + localCycle)}
        />
      </dl>
      <pre className="scrollbar-sleek mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 font-mono text-[11px]">
        {JSON.stringify(
          { policyOverrides: run.policyOverrides, promptOverrides: run.promptOverrides },
          null,
          2
        )}
      </pre>
    </section>
  )
}

export function WorkflowRunV2HistoryPanel({ run }: { run: WorkflowRunRecord }): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 text-sm font-medium">
        {translate('workflows.run.v2History', 'Append-only workflow history')}
      </h3>
      <div className="divide-y divide-border">
        {(run.v2History ?? []).map((entry) => (
          <article key={`${entry.cycle}:${entry.sequence}:${entry.stepId}`} className="p-4 text-xs">
            <p className="font-medium">
              {translate(
                'workflows.run.historyEntryMeta',
                '{{step}} · lineage cycle {{cycle}} · visit {{visit}} · attempt {{attempt}}',
                {
                  step: entry.stepName,
                  cycle: entry.cycle,
                  visit: entry.visit,
                  attempt: entry.attempt
                }
              )}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{entry.finalText}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function SnapshotValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="inline text-muted-foreground">{label}: </dt>
      <dd className="inline break-all font-mono">{value}</dd>
    </div>
  )
}
