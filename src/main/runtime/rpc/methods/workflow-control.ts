import { z } from 'zod'
import {
  assertWorkflowAssignmentAvailable,
  resolveWorkflowAssignmentAuthority
} from '../../workflows/workflow-agent-assignment-availability'
import { WorkflowError } from '../../workflows/workflow-error'
import { defineMethod, type RpcContext } from '../core'

const id = z.string().trim().min(1).max(180)
const requestId = z.string().trim().min(1).max(180)
const mutationBase = { requestId }
const runVersionParams = z
  .object({ ...mutationBase, runId: id, expectedVersion: z.number().int().min(1) })
  .strict()
const assignmentSchema = z
  .object({
    worktreeId: id,
    executionHostId: id,
    paneKey: id,
    agentLifecycleId: id,
    providerSessionId: id.nullable(),
    runtimeAgent: id.nullable()
  })
  .strict()
const runCancelParams = runVersionParams
  .extend({
    reason: z.string().trim().min(1).max(20_000),
    confirmation: z.literal(true),
    runningAgentAction: z.enum(['preserve-running', 'request-stop'])
  })
  .strict()
const runResolveParams = z
  .object({
    ...mutationBase,
    runId: id,
    offerId: id,
    reason: z.string().trim().min(1).max(20_000).optional(),
    reviewRoundBudget: z.number().int().min(1).max(20).optional(),
    confirmation: z.boolean()
  })
  .strict()
const stepRetryParams = runVersionParams
  .extend({
    stepRunId: id,
    reason: z.string().trim().min(1).max(20_000).optional()
  })
  .strict()
const stepReassignParams = runVersionParams
  .extend({
    stepRunId: id,
    assignment: assignmentSchema,
    reason: z.string().trim().min(1).max(20_000)
  })
  .strict()

export const WORKFLOW_CONTROL_METHODS = [
  defineMethod({
    name: 'workflow.runPause',
    params: runVersionParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .pauseRun(params, mutation(context, params, 'workflow.runPause'))
  }),
  defineMethod({
    name: 'workflow.runResume',
    params: runVersionParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const run = store.showRun(params.runId, callerIdentity(context))
      await Promise.all(
        run.assignments.map((assignment) =>
          assertWorkflowAssignmentAvailable(context.runtime, assignment)
        )
      )
      store.resumeRun(params, mutation(context, params, 'workflow.runResume'))
      return context.runtime.getWorkflowEngine().resume(params.runId, callerIdentity(context))
    }
  }),
  defineMethod({
    name: 'workflow.runCancel',
    params: runCancelParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const before = store.showRun(params.runId, callerIdentity(context))
      const cancelled = store.cancelRun(params, mutation(context, params, 'workflow.runCancel'))
      if (params.runningAgentAction === 'request-stop') {
        await context.runtime.getWorkflowEngine().requestStopRunningAgents(before)
      }
      return cancelled
    }
  }),
  defineMethod({
    name: 'workflow.runResolve',
    params: runResolveParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const updated = store.resolveRun(params, mutation(context, params, 'workflow.runResolve'))
      return updated.status === 'running'
        ? context.runtime.getWorkflowEngine().resume(updated.id, callerIdentity(context))
        : updated
    }
  }),
  defineMethod({
    name: 'workflow.stepRetry',
    params: stepRetryParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const updated = store.retryStep(params, mutation(context, params, 'workflow.stepRetry'))
      return context.runtime.getWorkflowEngine().resume(updated.id, callerIdentity(context))
    }
  }),
  defineMethod({
    name: 'workflow.stepReassign',
    params: stepReassignParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const run = store.showRun(params.runId, callerIdentity(context))
      if (
        run.workspace.id !== params.assignment.worktreeId ||
        run.executionHostId !== params.assignment.executionHostId
      ) {
        throw new WorkflowError(
          'workflow_context_mismatch',
          'Agent workspace or execution host does not match the run.'
        )
      }
      const assignment = await resolveWorkflowAssignmentAuthority(
        context.runtime,
        params.assignment
      )
      await assertWorkflowAssignmentAvailable(context.runtime, assignment, { claim: true })
      const canonicalParams = { ...params, assignment }
      const updated = store.reassignStep(
        canonicalParams,
        mutation(context, canonicalParams, 'workflow.stepReassign')
      )
      return context.runtime.getWorkflowEngine().resume(updated.id, callerIdentity(context))
    }
  })
] as const

function callerIdentity(context: RpcContext): string {
  return context.authenticatedCallerFingerprint ?? 'desktop-ipc'
}

function mutation(context: RpcContext, params: { requestId: string }, method: string) {
  return {
    callerIdentity: callerIdentity(context),
    requestId: params.requestId,
    method,
    payload: params
  }
}
