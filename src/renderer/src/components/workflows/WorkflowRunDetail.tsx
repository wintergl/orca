import { useEffect, useMemo, useState } from 'react'
import { Clipboard, Download } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowEventRecord,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { exportWorkflowRun, listWorkflowRunEvents } from './workflow-runtime-client'
import { setWorkflowSelectedStep } from './workflow-renderer-state'
import { WorkflowReviewAggregatePanel } from './WorkflowReviewAggregatePanel'
import { WorkflowResolutionPanel } from './WorkflowResolutionPanel'
import { WorkflowRunRerunButton } from './WorkflowRunRerunButton'
import { WorkflowRunPromptHistory } from './WorkflowRunPromptHistory'
import {
  WorkflowRunConfigurationSnapshot,
  WorkflowRunV2HistoryPanel
} from './WorkflowRunConfigurationSnapshot'
import { WorkflowRunV2BudgetSnapshot } from './WorkflowRunV2BudgetSnapshot'
import { WorkflowRunV1BudgetSnapshot } from './WorkflowRunV1BudgetSnapshot'
import { buildWorkflowDiagnosticSummary } from './workflow-diagnostic-summary'
import { ArtifactPanel, ContentPanel, StepIdentity, StepStateIcon } from './WorkflowRunStepPanels'

export function WorkflowRunDetail({
  run,
  target,
  selectedStepRunId,
  onBackToSetup,
  onRunUpdated,
  onRerunCreated
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  selectedStepRunId: string | null
  onBackToSetup: () => void
  onRunUpdated: (run: WorkflowRunRecord) => void
  onRerunCreated?: (run: WorkflowRunRecord) => void
}): React.JSX.Element {
  const [events, setEvents] = useState<WorkflowEventRecord[]>([])
  const selectedStep = useMemo(
    () =>
      run.steps.find((step) => step.id === selectedStepRunId) ??
      run.steps.toReversed().find((step) => step.nodeId === run.currentNodeId) ??
      run.steps[0] ??
      null,
    [run.currentNodeId, run.steps, selectedStepRunId]
  )
  const selectedAggregate = useMemo(() => {
    const aggregates = run.reviewAggregates ?? []
    return (
      aggregates.find(
        (aggregate) =>
          aggregate.reviewerStepRunIds.includes(selectedStep?.id ?? '') ||
          (selectedStep?.nodeType === 'decide' &&
            aggregate.artifactRevisionId === selectedStep.inputArtifactRevisionId)
      ) ??
      aggregates.toReversed()[0] ??
      null
    )
  }, [run.reviewAggregates, selectedStep])

  useEffect(() => {
    let cancelled = false
    void listWorkflowRunEvents(target, run.id)
      .then((result) => {
        if (!cancelled) {
          setEvents(result.events)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [run.id, run.updatedAt, target])

  return (
    <div className="grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(11rem,1fr)_minmax(0,4fr)]">
      <aside className="scrollbar-sleek min-h-0 overflow-y-auto border-r border-border bg-muted/20 p-3">
        <div className="mb-3">
          <h2 className="truncate text-sm font-semibold">{run.templateName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {run.status} · {run.workspace.kind} · {run.executionHostId}
          </p>
        </div>
        <div className="space-y-1">
          {run.steps.map((step) => (
            <button
              type="button"
              key={step.id}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left',
                selectedStep?.id === step.id ? 'bg-accent' : 'hover:bg-accent/60'
              )}
              onClick={() => setWorkflowSelectedStep(step.id)}
            >
              <StepStateIcon step={step} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{step.nodeName}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {step.status} ·{' '}
                  {step.assignment?.runtimeAgent ?? step.assignment?.agentLifecycleId ?? 'Engine'}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium">
            {translate('workflows.run.timeline', 'Event timeline')}
          </p>
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="text-[11px]">
                <p className="font-medium">{event.type}</p>
                <p className="text-muted-foreground">
                  #{event.sequence} · {formatTimestamp(event.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <main className="scrollbar-sleek min-h-0 overflow-y-auto p-5">
        <div className="w-full min-w-0 space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {selectedStep?.nodeName ??
                    translate('workflows.run.details', 'Workflow run details')}
                </h2>
                <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>
                  {selectedStep?.status ?? run.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedStep
                  ? translate(
                      'workflows.run.stepMetadata',
                      '{{type}} · local cycle {{round}} · lineage cycle {{lineageCycle}} · attempt {{attempt}}',
                      {
                        type: selectedStep.nodeType,
                        round: selectedStep.round,
                        lineageCycle: run.lineageCycleBase + selectedStep.round,
                        attempt: selectedStep.attempt
                      }
                    )
                  : run.objective}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyDiagnosticSummary(run, events)}
              >
                <Clipboard /> {translate('workflows.run.copyDiagnostics', 'Copy diagnostics')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadRunExport(target, run, 'markdown')}
              >
                <Download /> {translate('workflows.export.markdown', 'Markdown')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadRunExport(target, run, 'json')}
              >
                <Download /> {translate('workflows.export.json', 'JSON')}
              </Button>
              <WorkflowRunRerunButton run={run} target={target} onRerunCreated={onRerunCreated} />
              {run.status === 'draft' || run.status === 'ready' ? (
                <Button variant="outline" size="sm" onClick={onBackToSetup}>
                  {translate('workflows.page.runSetup', 'Run setup')}
                </Button>
              ) : null}
            </div>
          </header>
          {run.parentRunId ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'workflows.run.rerunBanner',
                'Another round from {{parent}}. Re-executes from the template entry with read-only parent history — not a checkpoint resume.',
                { parent: run.parentRunId }
              )}
            </p>
          ) : null}
          <WorkflowRunConfigurationSnapshot run={run} />
          <WorkflowRunV1BudgetSnapshot run={run} />
          <WorkflowRunV2BudgetSnapshot run={run} />
          <WorkflowRunPromptHistory run={run} selectedStepRunId={selectedStep?.id ?? null} />
          {run.failureMessage ? (
            <section className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <h3 className="text-sm font-medium text-destructive">{run.failureMessage}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{run.recovery}</p>
            </section>
          ) : null}
          {run.status === 'waiting-human' || run.status === 'review-limit-reached' ? (
            <WorkflowResolutionPanel
              run={run}
              target={target}
              onRunUpdated={onRunUpdated}
              onOpenEvidence={() => {
                const evidenceStepId = run.resolutionContext?.originDecisionStepId
                if (evidenceStepId) {
                  setWorkflowSelectedStep(evidenceStepId)
                }
              }}
            />
          ) : null}
          {selectedStep ? (
            <>
              <StepIdentity step={selectedStep} />
              <ContentPanel
                title={translate('workflows.run.conclusion', 'Complete conclusion')}
                content={selectedStep.conclusionMarkdown}
                empty={translate(
                  'workflows.run.conclusionPending',
                  'Complete conclusion is not available yet.'
                )}
              />
              {selectedStep.inputArtifactRevisionId || selectedStep.outputArtifactRevisionId ? (
                <ArtifactPanel run={run} step={selectedStep} />
              ) : null}
              {selectedAggregate ? (
                <WorkflowReviewAggregatePanel aggregate={selectedAggregate} run={run} />
              ) : null}
              {(run.v2History?.length ?? 0) > 0 ? <WorkflowRunV2HistoryPanel run={run} /> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate('workflows.run.noSteps', 'No Workflow Steps have been created.')}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

async function copyDiagnosticSummary(
  run: WorkflowRunRecord,
  events: readonly WorkflowEventRecord[]
): Promise<void> {
  await navigator.clipboard.writeText(buildWorkflowDiagnosticSummary(run, events))
  toast.success(translate('workflows.run.diagnosticsCopied', 'Diagnostic summary copied'))
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

async function downloadRunExport(
  target: RuntimeClientTarget,
  run: WorkflowRunRecord,
  format: 'markdown' | 'json'
): Promise<void> {
  try {
    const result = await exportWorkflowRun(target, run.id, format)
    const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(url))
    toast.success(
      translate('workflows.export.complete', 'Workflow export created: {{filename}}', {
        filename: result.filename
      })
    )
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('workflows.export.error', 'Could not export Workflow run')
    )
  }
}
