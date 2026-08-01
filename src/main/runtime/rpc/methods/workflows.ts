import { defineMethod, type RpcContext } from '../core'
import { WorkflowError } from '../../workflows/workflow-error'
import { releaseWorkflowAgentLifecycle } from '../../workflows/workflow-agent-lifecycle-authority'
import {
  assertWorkflowAssignmentAvailable,
  resolveWorkflowAssignmentAuthority,
  workflowAgentUnavailableReason,
  type WorkflowAgentUnavailableReason
} from '../../workflows/workflow-agent-assignment-availability'
import {
  isWorkflowHostCapabilityAvailable,
  isWorkflowWorkspaceAvailable
} from '../../workflows/workflow-preflight-capability'
import { assertWorkflowRunConfigurable } from '../../workflows/workflow-run-configuration-guard'
import { WORKFLOW_CONTROL_METHODS } from './workflow-control'
import {
  runAssignParams,
  runCreateParams,
  runEventsParams,
  runExportParams,
  runListParams,
  runPrepareParams,
  runShowParams,
  runStartParams,
  runSwitchTemplateParams,
  runUpdateParams,
  templateArchiveParams,
  templateCloneParams,
  templateCreateParams,
  templateListParams,
  templateShowParams,
  templateUpdateParams
} from './workflow-rpc-schemas'

function callerIdentity(context: RpcContext): string {
  return context.authenticatedCallerFingerprint ?? 'desktop-ipc'
}

function mutation(
  context: RpcContext,
  params: { requestId: string },
  method: string
): {
  callerIdentity: string
  requestId: string
  method: string
  payload: unknown
} {
  return {
    callerIdentity: callerIdentity(context),
    requestId: params.requestId,
    method,
    payload: params
  }
}

function assignmentKey(assignment: {
  nodeId: string
  slotId: string
  agentLifecycleId: string
}): string {
  return `${assignment.nodeId}\u0000${assignment.slotId}\u0000${assignment.agentLifecycleId}`
}

export const WORKFLOW_METHODS = [
  defineMethod({
    name: 'workflow.templateList',
    params: templateListParams,
    handler: (params, context) =>
      context.runtime.getWorkflowStore().listTemplates({
        callerIdentity: callerIdentity(context),
        ...params
      })
  }),
  defineMethod({
    name: 'workflow.templateShow',
    params: templateShowParams,
    handler: (params, context) =>
      context.runtime.getWorkflowStore().showTemplate({
        callerIdentity: callerIdentity(context),
        ...params
      })
  }),
  defineMethod({
    name: 'workflow.templateCreate',
    params: templateCreateParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .createTemplate(params, mutation(context, params, 'workflow.templateCreate'))
  }),
  defineMethod({
    name: 'workflow.templateUpdate',
    params: templateUpdateParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .updateTemplate(params, mutation(context, params, 'workflow.templateUpdate'))
  }),
  defineMethod({
    name: 'workflow.templateClone',
    params: templateCloneParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .cloneTemplate(params, mutation(context, params, 'workflow.templateClone'))
  }),
  defineMethod({
    name: 'workflow.templateArchive',
    params: templateArchiveParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .archiveTemplate(params, mutation(context, params, 'workflow.templateArchive'))
  }),
  defineMethod({
    name: 'workflow.runCreate',
    params: runCreateParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .createRun(params, mutation(context, params, 'workflow.runCreate'))
  }),
  defineMethod({
    name: 'workflow.runAssign',
    params: runAssignParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const run = store.showRun(params.runId, callerIdentity(context))
      assertWorkflowRunConfigurable(run)
      let canonicalParams = params
      if (params.assignment) {
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
        canonicalParams = { ...params, assignment }
      }
      const updated = store.assignAgent(
        canonicalParams,
        mutation(context, canonicalParams, 'workflow.runAssign')
      )
      const persisted = store.showRun(params.runId, callerIdentity(context))
      const retainedAssignments = new Set(persisted.assignments.map(assignmentKey))
      for (const previous of run.assignments) {
        if (!retainedAssignments.has(assignmentKey(previous))) {
          releaseWorkflowAgentLifecycle(context.runtime, previous)
        }
      }
      return updated
    }
  }),
  defineMethod({
    name: 'workflow.runList',
    params: runListParams,
    handler: (params, context) =>
      context.runtime.getWorkflowStore().listRuns(params, callerIdentity(context))
  }),
  defineMethod({
    name: 'workflow.runShow',
    params: runShowParams,
    handler: (params, context) =>
      context.runtime.getWorkflowStore().showRun(params.runId, callerIdentity(context))
  }),
  defineMethod({
    name: 'workflow.runExport',
    params: runExportParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .exportRun(params.runId, params.format, callerIdentity(context))
  }),
  defineMethod({
    name: 'workflow.runUpdate',
    params: runUpdateParams,
    handler: (params, context) =>
      context.runtime
        .getWorkflowStore()
        .updateRunObjective(params, mutation(context, params, 'workflow.runUpdate'))
  }),
  defineMethod({
    name: 'workflow.runSwitchTemplate',
    params: runSwitchTemplateParams,
    handler: (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const previous = store.showRun(params.runId, callerIdentity(context))
      const switched = store.switchRunTemplate(
        params,
        mutation(context, params, 'workflow.runSwitchTemplate')
      )
      const persisted = store.showRun(params.runId, callerIdentity(context))
      const retainedAssignments = new Set(persisted.assignments.map(assignmentKey))
      for (const assignment of previous.assignments) {
        if (!retainedAssignments.has(assignmentKey(assignment))) {
          releaseWorkflowAgentLifecycle(context.runtime, assignment)
        }
      }
      return switched
    }
  }),
  defineMethod({
    name: 'workflow.runPrepare',
    params: runPrepareParams,
    handler: async (params, context) => {
      const store = context.runtime.getWorkflowStore()
      const run = store.showRun(params.runId, callerIdentity(context))
      assertWorkflowRunConfigurable(run)
      const unavailableAgentLifecycleIds: string[] = []
      const unavailableAgentReasons: Record<string, WorkflowAgentUnavailableReason> = {}
      await Promise.all(
        run.assignments.map(async (assignment) => {
          try {
            await assertWorkflowAssignmentAvailable(context.runtime, assignment, { claim: true })
          } catch (error) {
            unavailableAgentLifecycleIds.push(assignment.agentLifecycleId)
            unavailableAgentReasons[assignment.agentLifecycleId] =
              workflowAgentUnavailableReason(error)
          }
        })
      )
      return store.prepareRun(
        {
          runId: run.id,
          workspaceAvailable: await isWorkflowWorkspaceAvailable(context.runtime, run.workspace.id),
          capabilityAvailable: isWorkflowHostCapabilityAvailable(run.executionHostId),
          unavailableAgentLifecycleIds,
          unavailableAgentReasons
        },
        mutation(context, params, 'workflow.runPrepare')
      )
    }
  }),
  defineMethod({
    name: 'workflow.runStart',
    params: runStartParams,
    handler: async (params, context) =>
      context.runtime
        .getWorkflowEngine()
        .start(
          params.runId,
          callerIdentity(context),
          mutation(context, params, 'workflow.runStart')
        )
  }),
  defineMethod({
    name: 'workflow.runEvents',
    params: runEventsParams,
    handler: (params, context) => {
      const store = context.runtime.getWorkflowStore()
      store.showRun(params.runId, callerIdentity(context))
      return store.runEvents(params.runId)
    }
  }),
  ...WORKFLOW_CONTROL_METHODS
] as const
