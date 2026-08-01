import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  WorkflowPreflightResult,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { translate } from '@/i18n/i18n'
import {
  prepareWorkflowRun,
  showWorkflowRun,
  startWorkflowRun,
  updateWorkflowRunObjective
} from './workflow-runtime-client'

export function useWorkflowRunApplicationActions({
  run,
  target,
  onRunUpdated,
  onPreflightUpdated,
  onStarted
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  onRunUpdated: (run: WorkflowRunRecord) => void
  onPreflightUpdated: (result: WorkflowPreflightResult) => void
  onStarted: () => void
}): {
  objective: string
  setObjective: (objective: string) => void
  busy: boolean
  prepare: () => Promise<void>
  start: () => Promise<void>
} {
  const [objective, setObjective] = useState(run.objective)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setObjective(run.objective)
  }, [run.id, run.objective])

  const prepare = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const savedRun =
        objective !== run.objective
          ? await updateWorkflowRunObjective(target, run.id, objective)
          : run
      onRunUpdated(savedRun)
      const result = await prepareWorkflowRun(target, savedRun.id)
      onPreflightUpdated(result)
      if (result.ready) {
        toast.success(
          translate('workflows.activity.readyNoPrompt', 'Draft is ready. No Agent prompt was sent.')
        )
      } else {
        toast.error(
          translate('workflows.activity.preflightAttention', 'Run preflight needs attention')
        )
      }
    } catch (error) {
      showError(error, translate('workflows.errors.preflight', 'Could not complete preflight'))
    } finally {
      setBusy(false)
    }
  }, [objective, onPreflightUpdated, onRunUpdated, run, target])

  const start = useCallback(async (): Promise<void> => {
    if (run.status !== 'ready') {
      return
    }
    setBusy(true)
    try {
      const started = await startWorkflowRun(target, run.id)
      onRunUpdated(started)
      onStarted()
      toast.success(translate('workflows.activity.started', 'Workflow started'))
    } catch (error) {
      showError(error, translate('workflows.errors.start', 'Could not start Workflow'))
      const current = await showWorkflowRun(target, run.id).catch(() => null)
      if (current) {
        onRunUpdated(current)
      }
    } finally {
      setBusy(false)
    }
  }, [onRunUpdated, onStarted, run.id, run.status, target])

  return { objective, setObjective, busy, prepare, start }
}

function showError(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback)
}
