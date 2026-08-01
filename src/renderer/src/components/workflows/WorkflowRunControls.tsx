import { useState } from 'react'
import { toast } from 'sonner'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  cancelWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  workflowTargetForExecutionHost
} from './workflow-runtime-client'
import { WorkflowCancelDialog } from './WorkflowCancelDialog'
import { WorkflowResolutionPanel } from './WorkflowResolutionPanel'

export function WorkflowRunControls({
  run,
  onRunUpdated,
  onOpenDetails
}: {
  run: WorkflowRunRecord
  onRunUpdated: (run: WorkflowRunRecord) => void
  onOpenDetails: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const target = workflowTargetForExecutionHost(run.executionHostId)

  const pause = async (): Promise<void> => {
    setBusy(true)
    try {
      onRunUpdated(await pauseWorkflowRun(target, run))
    } catch (error) {
      showError(error, translate('workflows.errors.pause', 'Could not pause Workflow'))
    } finally {
      setBusy(false)
    }
  }

  const resume = async (): Promise<void> => {
    setBusy(true)
    try {
      onRunUpdated(await resumeWorkflowRun(target, run))
    } catch (error) {
      showError(error, translate('workflows.errors.resume', 'Could not resume Workflow'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (
    reason: string,
    runningAgentAction: 'preserve-running' | 'request-stop'
  ): Promise<void> => {
    setBusy(true)
    try {
      onRunUpdated(
        await cancelWorkflowRun(target, run, {
          reason,
          confirmation: true,
          runningAgentAction
        })
      )
      setCancelOpen(false)
    } catch (error) {
      showError(error, translate('workflows.errors.cancel', 'Could not cancel Workflow'))
    } finally {
      setBusy(false)
    }
  }

  if (run.status === 'waiting-human' || run.status === 'review-limit-reached') {
    return (
      <>
        <WorkflowResolutionPanel
          run={run}
          target={target}
          onRunUpdated={onRunUpdated}
          onOpenEvidence={onOpenDetails}
        />
        <Button size="xs" variant="outline" className="w-full" onClick={onOpenDetails}>
          {translate('workflows.activity.details', 'Details')}
        </Button>
      </>
    )
  }

  return (
    <>
      <div className="flex gap-1.5">
        {run.status === 'running' ? (
          <Button size="xs" className="flex-1" disabled={busy} onClick={() => void pause()}>
            {translate('workflows.activity.pause', 'Pause')}
          </Button>
        ) : null}
        {run.status === 'paused' ? (
          <Button size="xs" className="flex-1" disabled={busy} onClick={() => void resume()}>
            {translate('workflows.activity.resume', 'Resume')}
          </Button>
        ) : null}
        <Button size="xs" variant="outline" className="flex-1" onClick={onOpenDetails}>
          {translate('workflows.activity.details', 'Details')}
        </Button>
        {run.status === 'running' || run.status === 'paused' ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
            {translate('workflows.activity.cancel', 'Cancel')}
          </Button>
        ) : null}
      </div>
      <WorkflowCancelDialog
        open={cancelOpen}
        busy={busy}
        onOpenChange={setCancelOpen}
        onConfirm={(reason, action) => void cancel(reason, action)}
      />
    </>
  )
}

function showError(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback)
}
