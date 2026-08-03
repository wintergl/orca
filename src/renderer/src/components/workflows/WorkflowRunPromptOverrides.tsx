import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { workflowAssignableUnits } from '../../../../shared/workflow-definition-access'
import type { WorkflowRunPromptOverrides } from '../../../../shared/workflow-run-lineage'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'

export function WorkflowRunPromptOverrideFields({
  run,
  value,
  onChange
}: {
  run: WorkflowRunRecord
  value: WorkflowRunPromptOverrides
  onChange: (value: WorkflowRunPromptOverrides) => void
}): React.JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">
          {translate('workflows.application.promptOverrides', 'Run prompt overrides')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {translate(
            'workflows.application.promptOverridesHint',
            'First visit and repeat visit are separate. Blank values keep the template prompt.'
          )}
        </p>
      </div>
      <div className="space-y-3">
        {workflowAssignableUnits(run.templateSnapshot).map((unit) => {
          const entry = value[unit.id] ?? {}
          return (
            <details key={unit.id} className="rounded-md border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium">{unit.name}</summary>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <PromptField
                  label={translate('workflows.prompt.firstVisit', 'First visit')}
                  value={entry.firstVisit ?? ''}
                  onChange={(firstVisit) => update(unit.id, { ...entry, firstVisit })}
                />
                <PromptField
                  label={translate('workflows.prompt.repeatVisit', 'Repeat visit')}
                  value={entry.repeatVisit ?? ''}
                  onChange={(repeatVisit) => update(unit.id, { ...entry, repeatVisit })}
                />
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )

  function update(nodeId: string, entry: { firstVisit?: string; repeatVisit?: string }): void {
    const firstVisit = entry.firstVisit?.trim() ? entry.firstVisit : undefined
    const repeatVisit = entry.repeatVisit?.trim() ? entry.repeatVisit : undefined
    const next = { ...value }
    if (firstVisit || repeatVisit) {
      next[nodeId] = { firstVisit, repeatVisit }
    } else {
      delete next[nodeId]
    }
    onChange(next)
  }
}

function PromptField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium">{label}</span>
      <Textarea
        value={value}
        className="min-h-28 text-xs leading-relaxed"
        placeholder={translate('workflows.application.useTemplatePrompt', 'Use template prompt')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
