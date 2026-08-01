import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowAgentAssignment,
  WorkflowPreflightResult,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Button } from '@/components/ui/button'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { launchAgentBackgroundSession } from '@/lib/launch-agent-background-session'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import {
  resolveTuiAgentPermissionMode,
  supportsTuiAgentPermissionMode
} from '../../../../shared/tui-agent-permissions'
import {
  isTuiAgentEnabled,
  normalizeDisabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import { assignWorkflowAgent } from './workflow-runtime-client'
import { useWorkflowRendererState, type WorkflowAssignableAgent } from './workflow-renderer-state'
import {
  WorkflowAgentAssignmentRows,
  type WorkflowAssignmentTarget
} from './WorkflowAgentAssignmentRows'
import { WorkflowAgentPickerDialog } from './WorkflowAgentPickerDialog'
import type { WorkflowNewAgentRequest } from './WorkflowNewAgentForm'

type SlotTarget = WorkflowAssignmentTarget | null
type PendingCreatedAgent = { target: WorkflowAssignmentTarget; paneKey: string }

export function WorkflowAgentAssignmentConfiguration({
  run,
  target,
  preflight,
  workspaceDrifted,
  onRunUpdated,
  onSwitchBack
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  preflight: WorkflowPreflightResult | null
  workspaceDrifted: boolean
  onRunUpdated: (run: WorkflowRunRecord) => void
  onSwitchBack: () => void
}): React.JSX.Element {
  const { availableAgents } = useWorkflowRendererState()
  const [pickerTarget, setPickerTarget] = useState<SlotTarget>(null)
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [pendingCreatedAgent, setPendingCreatedAgent] = useState<PendingCreatedAgent | null>(null)
  const settings = useAppStore((state) => state.settings)
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(run.workspace.id)
  const { detectedIds } = useDetectedAgents(agentDetectionTarget)
  const assignedPaneKeys = useMemo(
    () => new Set(run.assignments.map((assignment) => assignment.paneKey)),
    [run.assignments]
  )
  const eligibleAgents = useMemo(
    () =>
      availableAgents.filter(
        (agent) =>
          agent.worktreeId === run.workspace.id &&
          agent.executionHostId === run.executionHostId &&
          !assignedPaneKeys.has(agent.paneKey)
      ),
    [assignedPaneKeys, availableAgents, run.executionHostId, run.workspace.id]
  )
  const creatableAgents = useMemo(() => {
    const detected = new Set(detectedIds ?? [])
    const disabled = normalizeDisabledTuiAgents(settings?.disabledTuiAgents)
    return getAgentCatalog()
      .filter((agent) => detected.has(agent.id) && isTuiAgentEnabled(agent.id, disabled))
      .map((agent) => {
        const agentArgs = resolveTuiAgentLaunchArgs(agent.id, settings?.agentDefaultArgs)
        const agentEnv = resolveTuiAgentLaunchEnv(agent.id, settings?.agentDefaultEnv)
        return {
          id: agent.id,
          label: agent.label,
          commandHint: settings?.agentCmdOverrides?.[agent.id]?.trim() || agent.cmd,
          supportsYolo: supportsTuiAgentPermissionMode(agent.id),
          defaultYolo:
            resolveTuiAgentPermissionMode({ agent: agent.id, agentArgs, agentEnv }) !== 'manual'
        }
      })
  }, [detectedIds, settings])

  const assign = useCallback(
    async (
      slotTarget: Exclude<SlotTarget, null>,
      agent: WorkflowAssignableAgent
    ): Promise<void> => {
      try {
        const updated = await assignWorkflowAgent(target, {
          runId: run.id,
          ...slotTarget,
          assignment: {
            worktreeId: agent.worktreeId,
            executionHostId: agent.executionHostId,
            paneKey: agent.paneKey,
            agentLifecycleId: agent.agentLifecycleId,
            providerSessionId: agent.providerSessionId,
            runtimeAgent: agent.runtimeAgent
          }
        })
        onRunUpdated(updated)
        setPickerTarget(null)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate('workflows.errors.assignAgent', 'Could not assign Agent')
        )
      }
    },
    [onRunUpdated, run.id, target]
  )

  useEffect(() => {
    if (!pendingCreatedAgent) {
      return
    }
    const agent = availableAgents.find(
      (candidate) =>
        candidate.paneKey === pendingCreatedAgent.paneKey &&
        candidate.worktreeId === run.workspace.id &&
        candidate.executionHostId === run.executionHostId
    )
    if (!agent) {
      return
    }
    setPendingCreatedAgent(null)
    void assign(pendingCreatedAgent.target, agent)
  }, [assign, availableAgents, pendingCreatedAgent, run.executionHostId, run.workspace.id])

  const createAgent = async (request: WorkflowNewAgentRequest): Promise<void> => {
    if (!pickerTarget || creatingAgent) {
      return
    }
    setCreatingAgent(true)
    try {
      const result = await launchAgentBackgroundSession({
        ...request,
        worktreeId: run.workspace.id,
        launchSource: 'task_page'
      })
      if (!result) {
        throw new Error(
          translate(
            'workflows.agentPicker.createFailed',
            'Could not build the Agent launch command'
          )
        )
      }
      setPendingCreatedAgent({ target: pickerTarget, paneKey: result.paneKey })
      setPickerTarget(null)
      toast.success(
        translate(
          'workflows.agentPicker.created',
          'Agent created. It will be assigned when it becomes idle.'
        )
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.agentPicker.createFailed', 'Could not create Agent')
      )
    } finally {
      setCreatingAgent(false)
    }
  }

  const unassign = async (assignment: WorkflowAgentAssignment): Promise<void> => {
    try {
      const updated = await assignWorkflowAgent(target, {
        runId: run.id,
        nodeId: assignment.nodeId,
        slotId: assignment.slotId,
        assignment: null,
        removeAgentLifecycleId: assignment.agentLifecycleId
      })
      onRunUpdated(updated)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.errors.removeAssignment', 'Could not remove assignment')
      )
    }
  }

  return (
    <>
      <div className="space-y-5">
        {workspaceDrifted ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <div>
              <p className="text-sm font-medium">
                {translate(
                  'workflows.run.workspaceLocked',
                  'This Draft remains locked to another workspace.'
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'workflows.run.workspaceNotMoved',
                  'It was not moved when the active workspace changed.'
                )}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onSwitchBack}>
              {translate('workflows.run.switchBack', 'Switch back to Draft workspace')}
            </Button>
          </div>
        ) : null}
        <WorkflowAgentAssignmentRows
          run={run}
          onChoose={setPickerTarget}
          onAssign={(slotTarget, agent) => void assign(slotTarget, agent)}
          onUnassign={(assignment) => void unassign(assignment)}
        />
        {preflight ? <PreflightChecks result={preflight} /> : null}
      </div>
      <WorkflowAgentPickerDialog
        open={Boolean(pickerTarget)}
        agents={eligibleAgents}
        creatableAgents={creatableAgents}
        creatingAgent={creatingAgent}
        detectingCreatableAgents={detectedIds === null}
        onOpenChange={(open) => {
          if (!open) {
            setPickerTarget(null)
          }
        }}
        onSelect={(agent) => {
          if (pickerTarget) {
            setPendingCreatedAgent(null)
            void assign(pickerTarget, agent)
          }
        }}
        onCreate={(request) => void createAgent(request)}
      />
    </>
  )
}

function PreflightChecks({ result }: { result: WorkflowPreflightResult }): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">
        {translate('workflows.run.preflight', 'Run preflight')}
      </h3>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {result.checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2">
            {check.status === 'passed' ? (
              <CheckCircle2 className="mt-0.5 size-4 text-status-success" />
            ) : (
              <Circle className="mt-0.5 size-4 text-destructive" />
            )}
            <span className={cn('text-xs', check.status === 'failed' && 'text-destructive')}>
              {check.message}
              {check.recovery ? (
                <span className="mt-0.5 block text-muted-foreground">{check.recovery}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
