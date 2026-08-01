import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Download, FileText, LoaderCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowStepRunRecord
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

export function WorkflowRunDetail({
  run,
  target,
  selectedStepRunId,
  onBackToSetup,
  onRunUpdated
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  selectedStepRunId: string | null
  onBackToSetup: () => void
  onRunUpdated: (run: WorkflowRunRecord) => void
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
                      '{{type}} · round {{round}} · attempt {{attempt}}',
                      {
                        type: selectedStep.nodeType,
                        round: selectedStep.round,
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
              {run.status === 'draft' || run.status === 'ready' ? (
                <Button variant="outline" size="sm" onClick={onBackToSetup}>
                  {translate('workflows.page.runSetup', 'Run setup')}
                </Button>
              ) : null}
            </div>
          </header>
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
                title={translate('workflows.run.prompt', 'Actual prompt')}
                content={selectedStep.prompt}
                empty={translate('workflows.run.promptPending', 'Prompt has not been delivered.')}
              />
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

function StepIdentity({ step }: { step: WorkflowStepRunRecord }): React.JSX.Element {
  return (
    <section className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs sm:grid-cols-2">
      <Identity label={translate('workflows.run.stepRun', 'Step Run')} value={step.id} />
      <Identity
        label={translate('workflows.run.agent', 'Agent')}
        value={step.assignment?.agentLifecycleId ?? 'Engine'}
      />
      <Identity label={translate('workflows.run.task', 'Task')} value={step.taskId ?? 'pending'} />
      <Identity
        label={translate('workflows.run.dispatch', 'Dispatch')}
        value={step.dispatchId ?? 'pending'}
      />
      <Identity label={translate('workflows.run.delivery', 'Delivery')} value={step.deliveryId} />
      <Identity
        label={translate('workflows.run.source', 'Source')}
        value={step.messageSource ?? 'pending'}
      />
    </section>
  )
}

function Identity({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <p className="min-w-0">
      <span className="text-muted-foreground">{label}: </span>
      <span className="break-all font-mono">{value}</span>
    </p>
  )
}

function ContentPanel({
  title,
  content,
  empty
}: {
  title: string
  content: string | null
  empty: string
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 text-sm font-medium">{title}</h3>
      {content ? (
        <pre className="scrollbar-sleek max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">
          {content}
        </pre>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

function ArtifactPanel({
  run,
  step
}: {
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
}): React.JSX.Element | null {
  const artifactId = step.outputArtifactRevisionId ?? step.inputArtifactRevisionId
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId)
  if (!artifact) {
    return null
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">
          {translate('workflows.run.artifact', 'Artifact Revision')} {artifact.revision}
        </h3>
        <Badge variant="outline" className="ml-auto">
          {artifact.snapshotState}
        </Badge>
      </div>
      <pre className="scrollbar-sleek max-h-[24rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">
        {JSON.stringify(
          {
            id: artifact.id,
            executionHostId: artifact.executionHostId,
            digest: artifact.digest,
            locator: artifact.locator,
            materializedPath:
              artifact.executionHostId === 'local' ? artifact.materializedPath : null,
            remoteReference:
              artifact.executionHostId === 'local'
                ? null
                : 'Artifact remains on its execution host and is not opened as a local path.',
            manifest: artifact.manifest
          },
          null,
          2
        )}
      </pre>
    </section>
  )
}

function StepStateIcon({ step }: { step: WorkflowStepRunRecord }): React.JSX.Element {
  if (step.status === 'succeeded') {
    return <CheckCircle2 className="mt-0.5 size-4 text-status-success" />
  }
  if (step.status === 'running' || step.status === 'delivering') {
    return <LoaderCircle className="mt-0.5 size-4 animate-spin text-muted-foreground" />
  }
  if (
    step.status === 'failed' ||
    step.status === 'timed-out' ||
    step.status === 'completion-incomplete'
  ) {
    return <XCircle className="mt-0.5 size-4 text-destructive" />
  }
  return <Circle className="mt-0.5 size-4 text-muted-foreground" />
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
