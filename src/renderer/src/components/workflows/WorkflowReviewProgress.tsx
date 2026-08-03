import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function WorkflowReviewProgress({
  run,
  onOpenStep
}: {
  run: WorkflowRunRecord
  onOpenStep: (step: WorkflowStepRunRecord) => void
}): React.JSX.Element | null {
  if (run.templateSnapshot.schemaVersion !== 1) {
    return null
  }
  const reviewNode =
    run.templateSnapshot.nodes.find(
      (node) => node.id === run.currentNodeId && node.type === 'review'
    ) ??
    run.templateSnapshot.nodes
      .filter((node) => node.type === 'review')
      .toReversed()
      .find((node) => run.steps.some((step) => step.nodeId === node.id))
  const latestByAgent = latestReviewerSteps(
    run.steps.filter((step) => step.nodeId === reviewNode?.id)
  )
  const reviewers = [...latestByAgent.values()]
  if (!reviewNode || reviewers.length === 0) {
    return null
  }
  const completed = reviewers.filter((step) => step.status === 'succeeded').length
  const failed = reviewers.filter(
    (step) => step.status === 'failed' || step.status === 'timed-out'
  ).length
  const waiting = reviewers.length - completed - failed
  return (
    <details className="rounded-md border border-sidebar-border px-2 py-1.5">
      <summary className="cursor-pointer list-none text-[10px] text-sidebar-foreground">
        <span className="font-medium">
          {translate('workflows.activity.reviewRound', 'Round {{round}} · reviewing', {
            round: reviewers[0]?.round ?? 1
          })}
        </span>
        <span className="mt-0.5 block text-muted-foreground">
          {translate(
            'workflows.activity.reviewCompleted',
            '{{completed}} / {{total}} Reviewers completed',
            { completed, total: reviewers.length }
          )}
          {` · ${translate('workflows.activity.reviewWaiting', '{{count}} waiting', {
            count: waiting
          })}`}
          {failed > 0
            ? ` · ${translate('workflows.activity.reviewFailed', '{{count}} failed', {
                count: failed
              })}`
            : ''}
        </span>
      </summary>
      <div className="mt-1.5 space-y-1 border-t border-sidebar-border pt-1.5">
        {reviewers.map((step) => (
          <Button
            key={step.id}
            variant="ghost"
            size="xs"
            className="h-auto w-full justify-start gap-1 px-1 py-1 text-[10px]"
            onClick={() => onOpenStep(step)}
          >
            <ReviewerIcon step={step} />
            <span className="truncate">
              {step.assignment?.runtimeAgent ?? step.assignment?.agentLifecycleId ?? step.id}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">{step.status}</span>
          </Button>
        ))}
      </div>
    </details>
  )
}

function latestReviewerSteps(steps: WorkflowStepRunRecord[]): Map<string, WorkflowStepRunRecord> {
  const latest = new Map<string, WorkflowStepRunRecord>()
  for (const step of steps) {
    const key = step.assignment?.agentLifecycleId ?? step.id
    if ((latest.get(key)?.attempt ?? 0) <= step.attempt) {
      latest.set(key, step)
    }
  }
  return latest
}

function ReviewerIcon({ step }: { step: WorkflowStepRunRecord }): React.JSX.Element {
  if (step.status === 'succeeded') {
    return <CheckCircle2 className="size-3 text-status-success" />
  }
  if (step.status === 'failed' || step.status === 'timed-out') {
    return <XCircle className="size-3 text-destructive" />
  }
  return <Clock3 className="size-3 text-muted-foreground" />
}
