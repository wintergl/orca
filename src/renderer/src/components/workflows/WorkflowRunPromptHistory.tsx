import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

type PromptHistoryEntry = {
  key: string
  stepRunId: string | null
  stepName: string
  cycle: number
  attempt: number
  source: string
  prompt: string
}

export function WorkflowRunPromptHistory({
  run,
  selectedStepRunId
}: {
  run: WorkflowRunRecord
  selectedStepRunId: string | null
}): React.JSX.Element | null {
  const entries = buildPromptHistory(run)
  if (!entries.length) {
    return null
  }
  return (
    <section className="rounded-lg border border-border bg-card" data-workflow-prompt-history>
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">
          {translate('workflows.run.promptHistory', 'Prompt history')}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {translate(
            'workflows.run.promptHistoryHint',
            'Actual prompts delivered by this Run snapshot, including inherited lineage history.'
          )}
        </p>
      </header>
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <details key={entry.key} open={entry.stepRunId === selectedStepRunId} className="group">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium hover:bg-muted/30">
              {translate(
                'workflows.run.promptHistoryEntry',
                '{{step}} · lineage cycle {{cycle}} · attempt {{attempt}} · {{source}}',
                {
                  step: entry.stepName,
                  cycle: entry.cycle,
                  attempt: entry.attempt,
                  source: entry.source
                }
              )}
            </summary>
            <pre className="scrollbar-sleek max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-muted/20 p-4 font-mono text-[11px]">
              {entry.prompt}
            </pre>
          </details>
        ))}
      </div>
    </section>
  )
}

function buildPromptHistory(run: WorkflowRunRecord): PromptHistoryEntry[] {
  const entries: PromptHistoryEntry[] = []
  const indexBySignature = new Map<string, number>()
  for (const entry of run.v2History ?? []) {
    if (!entry.promptText?.trim()) {
      continue
    }
    const signature = promptSignature(entry.stepId, entry.cycle, entry.attempt, entry.promptText)
    indexBySignature.set(signature, entries.length)
    entries.push({
      key: `history:${entry.cycle}:${entry.sequence}:${entry.stepId}`,
      stepRunId: null,
      stepName: entry.stepName,
      cycle: entry.cycle,
      attempt: entry.attempt,
      source: translate('workflows.run.promptSourceHistory', 'Recorded history'),
      prompt: entry.promptText
    })
  }
  for (const step of run.steps) {
    if (!step.prompt.trim()) {
      continue
    }
    const cycle = run.lineageCycleBase + step.round
    const signature = promptSignature(step.nodeId, cycle, step.attempt, step.prompt)
    const existingIndex = indexBySignature.get(signature)
    if (existingIndex !== undefined) {
      entries[existingIndex] = { ...entries[existingIndex]!, stepRunId: step.id }
      continue
    }
    indexBySignature.set(signature, entries.length)
    entries.push({
      key: `step:${step.id}`,
      stepRunId: step.id,
      stepName: step.nodeName,
      cycle,
      attempt: step.attempt,
      source: promptSourceLabel(run, step.nodeId, cycle),
      prompt: step.prompt
    })
  }
  return entries
}

function promptSignature(stepId: string, cycle: number, attempt: number, prompt: string): string {
  return `${stepId}\u0000${cycle}\u0000${attempt}\u0000${prompt}`
}

function promptSourceLabel(run: WorkflowRunRecord, nodeId: string, cycle: number): string {
  const override = run.promptOverrides?.[nodeId]
  if (cycle > 1 ? override?.repeatVisit : override?.firstVisit) {
    return translate('workflows.run.promptSourceOverride', 'Run override')
  }
  return translate('workflows.run.promptSourceTemplate', 'Template snapshot')
}
