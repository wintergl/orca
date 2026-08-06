import type React from 'react'
import { useEffect, useMemo } from 'react'
import type { ProjectHostSetupProjection } from '../../../../shared/project-host-setup-projection'
import type { AiVaultAgent, AiVaultScope, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostScope } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/types'
import type { AppState } from '@/store/types'
import { AgentActivityBox } from './AgentActivityBox'
import { useAiVaultAgentActivity } from './use-ai-vault-agent-activity'
import { useAiVaultAgentActivityWorkspaces } from './use-ai-vault-agent-activity-workspaces'
import {
  setWorkflowAssignableAgents,
  type WorkflowAgentDisplayContext,
  type WorkflowAssignableAgent,
  useWorkflowRendererState
} from '../workflows/workflow-renderer-state'
import { toWorkflowAssignableAgent } from '../workflows/workflow-agent-drag'

type ResumeTargetState = Pick<
  AppState,
  'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'
>

type AiVaultAgentActivityInputs = {
  activeProjectKey: string | null
  activeWorktreeId: string | null | undefined
  activeWorktreePaths: readonly string[]
  allWorktrees: readonly Worktree[]
  enabledVaultAgents: readonly AiVaultAgent[]
  executionHostScope: ExecutionHostScope
  filteredSessions: readonly AiVaultSession[]
  projectHostSetupProjection: ProjectHostSetupProjection
  query: string
  resumeTargetState: ResumeTargetState
  scope: AiVaultScope
  sessions: readonly AiVaultSession[]
}

export function AiVaultAgentActivitySection(args: {
  activity: AiVaultAgentActivityInputs
}): React.JSX.Element | null {
  const { workspaceInfoById, workspaceScopeIds } = useAiVaultAgentActivityWorkspaces(args.activity)
  const filteredSessionIds = useMemo(
    () => new Set(args.activity.filteredSessions.map((session) => session.id)),
    [args.activity.filteredSessions]
  )
  const model = useAiVaultAgentActivity({
    sessions: args.activity.sessions,
    filteredSessionIds,
    hasSearchQuery: args.activity.query.trim().length > 0,
    enabledVaultAgents: args.activity.enabledVaultAgents,
    vaultScope: args.activity.scope,
    executionHostScope: args.activity.executionHostScope,
    activeProjectKey: args.activity.activeProjectKey,
    workspaceScopeIds,
    workspaceInfoById
  })
  const { activeRun } = useWorkflowRendererState()
  const workflowAgentCandidates = useMemo(
    () =>
      model.idle.reduce<WorkflowAssignableAgent[]>((agents, item) => {
        const agent = toWorkflowAssignableAgent(item)
        if (agent) {
          agents.push(agent)
        }
        return agents
      }, []),
    [model.idle]
  )
  useEffect(() => {
    setWorkflowAssignableAgents(workflowAgentCandidates)
  }, [workflowAgentCandidates])
  useEffect(
    () => () => {
      setWorkflowAssignableAgents([])
    },
    []
  )
  const workflowContextByLifecycleId = useMemo(() => {
    const contexts = new Map<string, WorkflowAgentDisplayContext>()
    if (!activeRun) {
      return contexts
    }
    for (const step of activeRun.steps) {
      const lifecycleId = step.assignment?.agentLifecycleId
      if (!lifecycleId) {
        continue
      }
      contexts.set(lifecycleId, {
        workflowName: activeRun.templateName,
        nodeName: step.nodeName,
        round: step.round,
        status: step.status,
        sentToNodeName:
          step.status === 'succeeded' ? workflowHandoffNodeName(activeRun, step.id) : null
      })
    }
    return contexts
  }, [activeRun])

  return (
    <AgentActivityBox model={model} workflowContextByLifecycleId={workflowContextByLifecycleId} />
  )
}

function workflowHandoffNodeName(
  run: NonNullable<ReturnType<typeof useWorkflowRendererState>['activeRun']>,
  stepId: string
): string | null {
  const step = run.steps.find((candidate) => candidate.id === stepId)
  if (step?.outputArtifactRevisionId) {
    return (
      run.steps.find(
        (candidate) => candidate.inputArtifactRevisionId === step.outputArtifactRevisionId
      )?.nodeName ?? null
    )
  }
  const aggregate = run.reviewAggregates.find((candidate) =>
    candidate.reviewerStepRunIds.includes(stepId)
  )
  if (!aggregate) {
    return null
  }
  return (
    run.steps.find((candidate) => candidate.id === run.resolutionContext?.originDecisionStepId)
      ?.nodeName ?? null
  )
}
