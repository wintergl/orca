import { GitMerge } from 'lucide-react'
import type {
  WorkflowReviewAggregate,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { setWorkflowSelectedStep } from './workflow-renderer-state'

export function WorkflowReviewAggregatePanel({
  aggregate,
  run
}: {
  aggregate: WorkflowReviewAggregate
  run: WorkflowRunRecord
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <GitMerge className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">
          {translate('workflows.run.reviewAggregate', 'Review Aggregate')}
        </h3>
        <Badge variant="outline" className="ml-auto">
          {aggregate.outcome}
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          {translate(
            'workflows.run.reviewAggregateMetadata',
            'Round {{round}} · {{count}} source Reviews · {{waitingReason}}',
            {
              round: aggregate.round,
              count: aggregate.reviewerStepRunIds.length,
              waitingReason: aggregate.waitingReason ?? 'complete'
            }
          )}
        </p>
        {aggregate.conflicts.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
            {aggregate.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        ) : null}
        <pre className="scrollbar-sleek max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-xs">
          {aggregate.content}
        </pre>
        <div className="flex flex-wrap gap-1.5">
          {aggregate.reviewerStepRunIds.map((stepRunId) => {
            const step = run.steps.find((candidate) => candidate.id === stepRunId)
            return (
              <Button
                key={stepRunId}
                size="xs"
                variant="outline"
                onClick={() => setWorkflowSelectedStep(stepRunId)}
              >
                {step?.assignment?.agentLifecycleId ?? stepRunId}
              </Button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
