import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'

export async function requestStopWorkflowAgents(
  runtime: OrcaRuntimeService,
  orchestration: OrchestrationDb,
  run: WorkflowRunRecord
): Promise<void> {
  const running = run.steps.filter(
    (step) => step.status === 'running' && step.dispatchId && step.assignment
  )
  await Promise.all(
    running.map(async (step) => {
      try {
        const begun = orchestration.beginWorkerStop(step.dispatchId!)
        if (begun.disposition === 'already_settled') {
          return
        }
        const resolved = runtime.resolveTerminalPane(
          step.assignment!.paneKey,
          step.assignment!.worktreeId
        )
        const processIncarnation = runtime.getTerminalProcessIncarnation(resolved.handle)
        if (
          !orchestration.isDispatchProcessCurrent({
            dispatchId: step.dispatchId!,
            paneKey: step.assignment!.paneKey,
            processIncarnation
          })
        ) {
          return
        }
        await runtime.closeTerminal(resolved.handle)
        orchestration.settleWorkerStop(step.dispatchId!)
      } catch {
        // The cancelled Run remains authoritative when an external Agent cannot be stopped.
      }
    })
  )
}
