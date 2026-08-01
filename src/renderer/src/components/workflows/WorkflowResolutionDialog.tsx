import type { WorkflowResolutionOffer } from '../../../../shared/workflow-definition-types'
import { WORKFLOW_REVIEW_ROUND_BUDGET_MAX } from '../../../../shared/workflow-review-round-budget'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { WorkflowAssignableAgent } from './workflow-renderer-state'
import { workflowResolutionActionLabel } from './workflow-resolution-action-label'

export function WorkflowResolutionDialog({
  offer,
  reason,
  reviewRoundBudget,
  busy,
  onReasonChange,
  onReviewRoundBudgetChange,
  reassignAgent,
  onChooseAgent,
  onOpenChange,
  onSubmit
}: {
  offer: WorkflowResolutionOffer | null
  reason: string
  reviewRoundBudget: number
  busy: boolean
  onReasonChange: (value: string) => void
  onReviewRoundBudgetChange: (value: number) => void
  reassignAgent: WorkflowAssignableAgent | null
  onChooseAgent: () => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}): React.JSX.Element {
  const label = offer ? workflowResolutionActionLabel(offer.action) : ''
  const invalidBudget =
    offer?.action === 'revise' &&
    (!Number.isInteger(reviewRoundBudget) ||
      reviewRoundBudget < 1 ||
      reviewRoundBudget > WORKFLOW_REVIEW_ROUND_BUDGET_MAX)
  return (
    <Dialog open={Boolean(offer)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {translate(
              'workflows.resolution.confirmDescription',
              'The Engine will revalidate the current Offer and Run version before changing state.'
            )}
          </DialogDescription>
        </DialogHeader>
        {offer?.requiresReason || offer?.action === 'revise' || offer?.action === 'end-workflow' ? (
          <Textarea
            autoFocus
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            aria-label={translate('workflows.resolution.reason', 'Resolution reason')}
            placeholder={translate(
              'workflows.resolution.reasonPlaceholder',
              'Revision instructions are inserted into the humanInstructions placeholder for the next Agent'
            )}
            className="min-h-24"
          />
        ) : null}
        {offer?.action === 'revise' ? (
          <ReviewRoundBudget value={reviewRoundBudget} onChange={onReviewRoundBudgetChange} />
        ) : null}
        {offer?.action === 'reassign-agent' ? (
          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full" onClick={onChooseAgent}>
              {reassignAgent
                ? reassignAgent.label
                : translate('workflows.resolution.chooseAgent', 'Choose replacement Agent')}
            </Button>
            <Textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              aria-label={translate('workflows.resolution.reason', 'Resolution reason')}
              placeholder={translate(
                'workflows.resolution.reassignReason',
                'Record why this Agent is being replaced'
              )}
              className="min-h-20"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {translate('auto.components.ui.dialog.f26c4baeda', 'Close')}
          </Button>
          <Button
            variant={offer?.action === 'end-workflow' ? 'destructive' : 'default'}
            disabled={
              busy ||
              Boolean(offer?.requiresReason && !reason.trim()) ||
              invalidBudget ||
              Boolean(offer?.action === 'reassign-agent' && (!reassignAgent || !reason.trim()))
            }
            onClick={onSubmit}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewRoundBudget({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="workflow-review-round-budget">
          {translate('workflows.resolution.reviewRoundBudget', 'Review rounds after intervention')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'workflows.resolution.reviewRoundBudgetHint',
            'Each completed Review consumes one round. The workflow pauses again when this budget reaches zero.'
          )}
        </p>
      </div>
      <Input
        id="workflow-review-round-budget"
        type="number"
        min={1}
        max={WORKFLOW_REVIEW_ROUND_BUDGET_MAX}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
