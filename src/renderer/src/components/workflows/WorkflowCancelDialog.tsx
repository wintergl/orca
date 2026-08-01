import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'

export function WorkflowCancelDialog({
  open,
  busy,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string, runningAgentAction: 'preserve-running' | 'request-stop') => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [runningAgentAction, setRunningAgentAction] = useState<'preserve-running' | 'request-stop'>(
    'preserve-running'
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{translate('workflows.cancel.title', 'Cancel Workflow')}</DialogTitle>
          <DialogDescription>
            {translate(
              'workflows.cancel.description',
              'Cancelling stops new Dispatches. It does not delete the workspace or roll back files.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label={translate('workflows.cancel.reason', 'Cancellation reason')}
          placeholder={translate('workflows.cancel.reasonPlaceholder', 'Record why this Run ended')}
          className="min-h-24"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={runningAgentAction === 'preserve-running' ? 'secondary' : 'outline'}
            onClick={() => setRunningAgentAction('preserve-running')}
          >
            {translate('workflows.cancel.preserve', 'Keep Agent running')}
          </Button>
          <Button
            type="button"
            variant={runningAgentAction === 'request-stop' ? 'secondary' : 'outline'}
            onClick={() => setRunningAgentAction('request-stop')}
          >
            {translate('workflows.cancel.stop', 'Request Agent stop')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {translate('auto.components.ui.dialog.f26c4baeda', 'Close')}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim(), runningAgentAction)}
          >
            {translate('workflows.cancel.confirm', 'Cancel Workflow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
