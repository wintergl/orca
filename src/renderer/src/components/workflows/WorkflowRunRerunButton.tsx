import { useState } from 'react'
import { toast } from 'sonner'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { createWorkflowRunRerun } from './workflow-runtime-client'

export function WorkflowRunRerunButton({
  run,
  target,
  onRerunCreated
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  onRerunCreated?: (run: WorkflowRunRecord) => void
}): React.JSX.Element | null {
  const [rerunning, setRerunning] = useState(false)
  if (run.status !== 'completed') {
    return null
  }
  return (
    <Button
      size="sm"
      disabled={rerunning}
      onClick={() => {
        setRerunning(true)
        void createWorkflowRunRerun(target, {
          parentRunId: run.id,
          noAdditionalRequirements: true,
          copyAssignments: true
        })
          .then((child) => {
            onRerunCreated?.(child)
            toast.success(
              translate(
                'workflows.run.rerunCreated',
                'Started another round from this completed run.'
              )
            )
          })
          .catch((error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : translate('workflows.run.rerunFailed', 'Could not start another round.')
            )
          })
          .finally(() => setRerunning(false))
      }}
    >
      {translate('workflows.run.anotherRound', 'Another round')}
    </Button>
  )
}
