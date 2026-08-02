import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  getWorkflowCompletion,
  listUnsettledCompletions,
  receiveWorkflowCompletion
} from './workflow-completion-reconciliation-store'
import type { WorkflowPreparedCompletion } from './workflow-completion-prepare'
import {
  continueSuccessReconciliation,
  preparedFromRecord
} from './workflow-completion-success-continue'
import { buildSuccessPayloadFromPrepared } from './workflow-completion-success-payload'
import { WorkflowError } from './workflow-error'
import type { WorkflowStore } from './workflow-store'

export type WorkflowSuccessReconcileResult = {
  receiptId: string
  duplicate: boolean
  conflict: boolean
  nextNodeId: string | null
}

/**
 * Shared success path:
 * receive → internal worker_done/lifecycle orch settle → (produce freeze) → workflow settle.
 */
export async function reconcileWorkflowStepSuccess(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
  step: WorkflowStepRunRecord
  prepared: WorkflowPreparedCompletion
}): Promise<WorkflowSuccessReconcileResult> {
  const nodeType = params.step.nodeType
  if (nodeType !== 'produce' && nodeType !== 'review' && nodeType !== 'decide') {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Success reconciliation only supports Produce, Review, and Decision steps.'
    )
  }
  const payload = buildSuccessPayloadFromPrepared(nodeType, params.prepared)
  if (!payload) {
    throw new WorkflowError(
      'workflow_completion_incomplete',
      'Success result failed schema validation before receipt.'
    )
  }
  const db = params.store.persistenceDb
  const received = receiveWorkflowCompletion(db, {
    runId: params.run.id,
    stepRunId: params.step.id,
    attempt: params.step.attempt,
    taskId: params.step.taskId,
    dispatchId: params.step.dispatchId,
    messageDigest: params.prepared.digest,
    outcome: 'succeeded',
    successPayload: payload
  })
  if (received.conflict) {
    return {
      receiptId: received.record.receiptId,
      duplicate: true,
      conflict: true,
      nextNodeId: null
    }
  }
  if (!received.created && received.record.state === 'settled') {
    return {
      receiptId: received.record.receiptId,
      duplicate: true,
      conflict: false,
      nextNodeId: null
    }
  }
  return continueSuccessReconciliation({
    store: params.store,
    orchestration: params.orchestration,
    runtime: params.runtime,
    run: params.run,
    step: params.step,
    prepared: params.prepared,
    record: getWorkflowCompletion(db, received.record.receiptId) ?? received.record,
    duplicate: !received.created
  })
}

export async function resumeWorkflowSuccessCompletions(params: {
  store: WorkflowStore
  orchestration: OrchestrationDb
  runtime: OrcaRuntimeService
  run: WorkflowRunRecord
}): Promise<void> {
  const db = params.store.persistenceDb
  for (const record of listUnsettledCompletions(db, params.run.id)) {
    if (record.outcome !== 'succeeded') {
      continue
    }
    const step = params.store.getStep(record.stepRunId)
    if (!step) {
      continue
    }
    await continueSuccessReconciliation({
      store: params.store,
      orchestration: params.orchestration,
      runtime: params.runtime,
      run: params.run,
      step,
      prepared: preparedFromRecord(record),
      record,
      duplicate: true
    })
  }
}
