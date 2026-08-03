import type { WorkflowPromptPreview } from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function WorkflowRunPromptPreviews({
  previews
}: {
  previews: readonly WorkflowPromptPreview[]
}): React.JSX.Element | null {
  if (previews.length === 0) {
    return null
  }
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">
        {translate('workflows.prompt.actualPreviews', 'Actual prompt previews')}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {translate(
          'workflows.prompt.actualPreviewsHint',
          'Rendered from this Run snapshot and its read-only lineage history. Engine protocol text remains protected.'
        )}
      </p>
      <div className="mt-3 space-y-4">
        {previews.map((preview) => (
          <article key={preview.nodeId} className="rounded-md border border-border p-3">
            <p className="text-xs font-semibold">
              {preview.nodeName}{' '}
              <span className="font-mono text-muted-foreground">{preview.nodeId}</span>
            </p>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <PromptPreview
                label={translate('workflows.prompt.firstVisit', 'First visit')}
                value={preview.firstVisit}
              />
              <PromptPreview
                label={translate('workflows.prompt.repeatVisit', 'Repeat visit')}
                value={preview.repeatVisit}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function PromptPreview({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <section className="min-w-0">
      <h4 className="text-[11px] font-medium">{label}</h4>
      <pre className="scrollbar-sleek mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-[11px]">
        {value || translate('workflows.prompt.previewEmpty', 'No content is rendered.')}
      </pre>
    </section>
  )
}
