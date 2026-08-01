import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../orchestration/db'
import type {
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { recordIgnoredLateCompletions } from './workflow-late-completion'
import type { WorkflowStore } from './workflow-store'

describe('recordIgnoredLateCompletions', () => {
  it('audits a superseded Dispatch once without advancing the Review round', () => {
    const oldStep = step({
      id: 'step-old',
      status: 'completion-incomplete',
      attempt: 1,
      dispatchId: 'dispatch-old',
      taskId: 'task-old'
    })
    const replacement = step({
      id: 'step-replacement',
      status: 'running',
      attempt: 2,
      dispatchId: 'dispatch-replacement',
      taskId: 'task-replacement'
    })
    const run = {
      id: 'run-1',
      orchestrationRunId: 'orchestration-run-1',
      steps: [oldStep, replacement]
    } as WorkflowRunRecord
    const events: WorkflowEventRecord[] = []
    const recordLateCompletionIgnored = vi.fn(
      (runId: string, stepRunId: string, payload: Record<string, unknown>) => {
        events.push({
          id: 'event-1',
          runId,
          sequence: 1,
          type: 'late-completion-ignored',
          stepRunId,
          payload,
          createdAt: '2026-07-29T00:00:00.000Z'
        })
      }
    )
    const store = {
      runEvents: () => ({ runId: run.id, events }),
      recordLateCompletionIgnored
    } as Pick<WorkflowStore, 'recordLateCompletionIgnored' | 'runEvents'>
    const orchestration = {
      getTask: () => ({ status: 'completed' }),
      getRunMailboxHistory: () => [
        {
          payload: JSON.stringify({
            taskId: oldStep.taskId,
            dispatchId: oldStep.dispatchId
          })
        }
      ]
    } as unknown as Pick<OrchestrationDb, 'getRunMailboxHistory' | 'getTask'>

    recordIgnoredLateCompletions({ store, orchestration, run })
    recordIgnoredLateCompletions({ store, orchestration, run })

    expect(recordLateCompletionIgnored).toHaveBeenCalledTimes(1)
    expect(recordLateCompletionIgnored).toHaveBeenCalledWith(
      run.id,
      oldStep.id,
      expect.objectContaining({
        replacementStepRunId: replacement.id,
        round: 1,
        attempt: 1,
        reason: 'superseded-dispatch'
      })
    )
    expect(run.steps.map((candidate) => candidate.round)).toEqual([1, 1])
  })
})

function step(
  overrides: Partial<WorkflowStepRunRecord> & Pick<WorkflowStepRunRecord, 'id' | 'status'>
): WorkflowStepRunRecord {
  return {
    id: overrides.id,
    runId: 'run-1',
    nodeId: 'review',
    nodeName: 'Review',
    nodeType: 'review',
    round: overrides.round ?? 1,
    attempt: overrides.attempt ?? 1,
    status: overrides.status,
    assignment: null,
    orchestrationRunId: 'orchestration-run-1',
    taskId: overrides.taskId ?? null,
    dispatchId: overrides.dispatchId ?? null,
    deliveryId: 'delivery-1',
    deliveryState: 'delivered',
    prompt: '',
    conclusionMarkdown: null,
    resultEnvelope: null,
    messageSource: null,
    messageDigest: null,
    sourceIdentity: null,
    sourceWarnings: [],
    inputArtifactRevisionId: 'artifact-1',
    outputArtifactRevisionId: null,
    errorCode: null,
    errorMessage: null,
    recovery: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z'
  }
}
