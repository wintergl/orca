import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Circle, History, LoaderCircle, Workflow, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowStepRunRecord,
  WorkflowStepRunStatus,
  WorkflowTemplateRecord
} from '../../../../shared/workflow-definition-types'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  WorkflowActivityLauncher,
  WorkflowRunConfigurationSummary
} from './WorkflowActivityLauncher'
import {
  createWorkflowRun,
  getWorkflowV2FeatureEnabled,
  listWorkflowTemplates,
  setWorkflowV2FeatureEnabled,
  showWorkflowRun,
  workflowTargetForExecutionHost
} from './workflow-runtime-client'
import {
  setWorkflowActiveRun,
  setWorkflowPage,
  setWorkflowSelectedStep,
  setWorkflowSelectedTemplate,
  useWorkflowRendererState,
  type WorkflowPage
} from './workflow-renderer-state'
import { useWorkflowWorkspaceContext } from './use-workflow-workspace-context'
import { WorkflowReviewProgress } from './WorkflowReviewProgress'
import { WorkflowRunControls } from './WorkflowRunControls'
import {
  workflowRunStatusLabel,
  workflowStepStatusLabel,
  workflowWorkspaceKindLabel
} from './workflow-runtime-state-labels'

const POLL_INTERVAL_MS = 1_000

export function WorkflowActivityBox(): React.JSX.Element {
  const openWorkflowsPage = useAppStore((state) => state.openWorkflowsPage)
  const { context, fallbackTarget } = useWorkflowWorkspaceContext()
  const { selectedTemplate, activeRun } = useWorkflowRendererState()
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [workflowV2Enabled, setWorkflowV2EnabledState] = useState<boolean | null>(null)
  const [enablingWorkflowV2, setEnablingWorkflowV2] = useState(false)
  const activeRunId = activeRun?.id
  const activeRunStatus = activeRun?.status
  const activeExecutionHostId = activeRun?.executionHostId
  const templateTarget = context?.target ?? fallbackTarget
  const selectedTemplateId = selectedTemplate?.id

  useEffect(() => {
    let cancelled = false
    setLoadingTemplates(true)
    void Promise.all([
      listWorkflowTemplates(templateTarget, context?.projectIdentity, false),
      getWorkflowV2FeatureEnabled(templateTarget)
    ])
      .then(([rows, v2Enabled]) => {
        if (cancelled) {
          return
        }
        setTemplates(rows)
        setWorkflowV2EnabledState(v2Enabled)
        if (!selectedTemplateId || !rows.some((template) => template.id === selectedTemplateId)) {
          setWorkflowSelectedTemplate(rows[0] ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTemplates(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [context?.projectIdentity, selectedTemplateId, templateTarget])

  useEffect(() => {
    if (
      !activeRunId ||
      !['running', 'paused'].includes(activeRunStatus ?? '') ||
      !activeExecutionHostId
    ) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async (): Promise<void> => {
      try {
        const current = await showWorkflowRun(
          workflowTargetForExecutionHost(activeExecutionHostId),
          activeRunId
        )
        if (!cancelled) {
          setWorkflowActiveRun(current)
          if (current.status === 'running' || current.status === 'paused') {
            timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
          }
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
        }
      }
    }
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [activeExecutionHostId, activeRunId, activeRunStatus])

  const openPage = (page: WorkflowPage): void => {
    setWorkflowPage(page)
    openWorkflowsPage()
  }

  const configureRun = async (): Promise<void> => {
    if (!selectedTemplate || !context) {
      return
    }
    setBusy(true)
    try {
      const run = await createWorkflowRun(context.target, {
        templateId: selectedTemplate.id,
        projectIdentity: context.projectIdentity,
        workspace: { kind: context.workspaceKind, id: context.workspaceId },
        executionHostId: context.executionHostId
      })
      setWorkflowActiveRun(run)
      openPage('application')
      toast.success(
        translate('workflows.activity.configurationCreated', 'Run configuration created')
      )
    } catch (error) {
      showError(error, translate('workflows.errors.createDraft', 'Could not create Workflow Draft'))
    } finally {
      setBusy(false)
    }
  }

  const enableWorkflowV2 = async (): Promise<void> => {
    setEnablingWorkflowV2(true)
    try {
      const enabled = await setWorkflowV2FeatureEnabled(templateTarget, true)
      setWorkflowV2EnabledState(enabled)
      toast.success(translate('workflows.v2.enabled', 'Workflow V2 enabled on this host'))
    } catch (error) {
      showError(error, translate('workflows.v2.enableError', 'Could not enable Workflow V2'))
    } finally {
      setEnablingWorkflowV2(false)
    }
  }

  const openStep = (step: WorkflowStepRunRecord | undefined): void => {
    setWorkflowSelectedStep(step?.id ?? null)
    openPage('runs')
  }

  const defaultPage: WorkflowPage = activeRun
    ? activeRun.status === 'draft' || activeRun.status === 'ready'
      ? 'application'
      : 'runs'
    : 'templates'

  return (
    <section className="border-b border-sidebar-border px-2 py-2">
      <div className="rounded-md border border-sidebar-border bg-[color:color-mix(in_srgb,var(--sidebar-foreground)_3%,var(--sidebar))]">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-2 py-1.5">
          <Workflow className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-sidebar-foreground">
            {translate('workflows.activity.compactTitle', 'Workflow')}
          </span>
          {activeRun ? (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {workflowRunStatusLabel(activeRun.status)}
            </span>
          ) : (
            <span className="ml-auto" />
          )}
          <Button size="xs" variant="ghost" onClick={() => openPage('runs')}>
            <History />
            {translate('workflows.history.short', 'History')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => openPage(defaultPage)}>
            {translate('workflows.activity.openShort', 'Open')}
            <ArrowUpRight />
          </Button>
        </div>
        <div className="space-y-2 p-2">
          {activeRun ? (
            activeRun.status === 'draft' || activeRun.status === 'ready' ? (
              <WorkflowRunConfigurationSummary
                run={activeRun}
                onContinue={() => openPage('application')}
              />
            ) : (
              <>
                <RunSummary run={activeRun} onOpenStep={openStep} />
                <WorkflowReviewProgress run={activeRun} onOpenStep={openStep} />
                {activeRun.status === 'failed' ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
                    <p className="text-[10px] font-medium text-destructive">
                      {activeRun.failureMessage}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{activeRun.recovery}</p>
                  </div>
                ) : null}
                <WorkflowRunControls
                  run={activeRun}
                  onRunUpdated={setWorkflowActiveRun}
                  onOpenDetails={() => openStep(undefined)}
                />
                {['completed', 'failed', 'cancelled'].includes(activeRun.status) ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-full"
                    onClick={() => setWorkflowActiveRun(null)}
                  >
                    {translate('workflows.activity.newRun', 'Configure another run')}
                  </Button>
                ) : null}
              </>
            )
          ) : (
            <WorkflowActivityLauncher
              templates={templates}
              selectedTemplate={selectedTemplate}
              workspaceLabel={
                context
                  ? `${context.projectName} · ${context.workspaceName}`
                  : translate('workflows.activity.noWorkspace', 'No project workspace selected')
              }
              workflowV2Enabled={workflowV2Enabled}
              enablingWorkflowV2={enablingWorkflowV2}
              disabled={!context || loadingTemplates || !selectedTemplate || busy}
              onSelect={(templateId) =>
                setWorkflowSelectedTemplate(
                  templates.find((template) => template.id === templateId) ?? null
                )
              }
              onConfigure={() => void configureRun()}
              onEnableWorkflowV2={() => void enableWorkflowV2()}
              onOpenTemplates={() => openPage('templates')}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function RunSummary({
  run,
  onOpenStep
}: {
  run: NonNullable<ReturnType<typeof useWorkflowRendererState>['activeRun']>
  onOpenStep: (step: WorkflowStepRunRecord | undefined) => void
}): React.JSX.Element {
  const visibleNodes =
    run.templateSnapshot.schemaVersion === 1
      ? run.templateSnapshot.nodes.filter(
          (node) => node.type === 'produce' || node.type === 'review' || node.type === 'complete'
        )
      : run.templateSnapshot.steps.filter(
          (step) => step.kind === 'agent' || step.kind === 'decision' || step.kind === 'end'
        )
  const currentStep = run.steps.toReversed().find((step) => step.nodeId === run.currentNodeId)
  return (
    <>
      <div>
        <p className="truncate text-[11px] font-medium text-sidebar-foreground">
          {run.templateName}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {currentStep
            ? `${currentStep.nodeName} · ${currentStep.assignment?.runtimeAgent ?? workflowStepStatusLabel(currentStep.status)}`
            : `${translate('workflows.runtime.templateVersion', 'Version {{version}}', { version: run.templateVersion })} · ${workflowWorkspaceKindLabel(run.workspace.kind)}`}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {visibleNodes.map((node, index) => {
          const step = run.steps.toReversed().find((candidate) => candidate.nodeId === node.id)
          return (
            <div key={node.id} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-0.5 text-left text-[10px] hover:bg-sidebar-accent"
                onClick={() => onOpenStep(step)}
              >
                <StepIcon status={step?.status} />
                <span className="truncate">{node.name}</span>
              </button>
              {index < visibleNodes.length - 1 ? (
                <span className="text-muted-foreground">→</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}

function StepIcon({ status }: { status: WorkflowStepRunStatus | undefined }): React.JSX.Element {
  if (status === 'succeeded') {
    return <Check className="size-3 text-status-success" />
  }
  if (status === 'running' || status === 'delivering') {
    return <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
  }
  if (status === 'failed' || status === 'timed-out' || status === 'completion-incomplete') {
    return <XCircle className="size-3 text-destructive" />
  }
  return <Circle className="size-3 text-muted-foreground" />
}

function showError(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback)
}
