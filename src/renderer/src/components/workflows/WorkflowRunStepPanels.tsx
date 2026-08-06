import { CheckCircle2, Circle, FileText, LoaderCircle, XCircle } from 'lucide-react'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../../shared/workflow-definition-types'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import {
  workflowArtifactStateLabel,
  workflowMessageSourceLabel,
  workflowRuntimeValueLabel
} from './workflow-runtime-state-labels'

export function StepIdentity({ step }: { step: WorkflowStepRunRecord }): React.JSX.Element {
  return (
    <section className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs sm:grid-cols-2">
      <Identity label={translate('workflows.run.stepRun', 'Step Run')} value={step.id} />
      <Identity
        label={translate('workflows.run.agent', 'Agent')}
        value={step.assignment?.agentLifecycleId ?? workflowRuntimeValueLabel('engine')}
      />
      <Identity
        label={translate('workflows.run.task', 'Task')}
        value={step.taskId ?? workflowRuntimeValueLabel('pending')}
      />
      <Identity
        label={translate('workflows.run.dispatch', 'Dispatch')}
        value={step.dispatchId ?? workflowRuntimeValueLabel('pending')}
      />
      <Identity label={translate('workflows.run.delivery', 'Delivery')} value={step.deliveryId} />
      <Identity
        label={translate('workflows.run.source', 'Source')}
        value={
          step.messageSource
            ? workflowMessageSourceLabel(step.messageSource)
            : workflowRuntimeValueLabel('pending')
        }
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

export function ContentPanel({
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

export function ArtifactPanel({
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
          {workflowArtifactStateLabel(artifact.snapshotState)}
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
                : translate(
                    'workflows.run.remoteArtifactReference',
                    'Artifact remains on its execution host and is not opened as a local path.'
                  ),
            manifest: artifact.manifest
          },
          null,
          2
        )}
      </pre>
    </section>
  )
}

export function StepStateIcon({ step }: { step: WorkflowStepRunRecord }): React.JSX.Element {
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
