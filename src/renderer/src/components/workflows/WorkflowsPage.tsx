import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { toast } from 'sonner'
import type { WorkflowTemplateRecord } from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { WorkflowRunApplicationPage } from './WorkflowRunApplicationPage'
import { WorkflowRunHistory } from './WorkflowRunHistory'
import { WorkflowTemplateWorkspace } from './WorkflowTemplateWorkspace'
import {
  listWorkflowTemplates,
  getWorkflowV2FeatureEnabled,
  setWorkflowV2FeatureEnabled,
  switchWorkflowRunTemplate,
  workflowTargetForExecutionHost
} from './workflow-runtime-client'
import {
  getWorkflowSelectedTemplate,
  setWorkflowActiveRun,
  setWorkflowPage,
  setWorkflowPreflight,
  setWorkflowSelectedTemplate,
  useWorkflowRendererState
} from './workflow-renderer-state'
import { resolveWorkflowTemplateListContext } from './workflow-template-list-context'
import { useWorkflowWorkspaceContext } from './use-workflow-workspace-context'

export default function WorkflowsPage(): React.JSX.Element {
  const closeWorkflowsPage = useAppStore((state) => state.closeWorkflowsPage)
  const { context, fallbackTarget } = useWorkflowWorkspaceContext()
  const { page, selectedTemplate, activeRun, preflight, selectedStepRunId } =
    useWorkflowRendererState()
  const [templates, setTemplates] = useState<WorkflowTemplateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [switchingTemplate, setSwitchingTemplate] = useState(false)
  const [workflowV2Enabled, setWorkflowV2EnabledState] = useState<boolean | null>(null)
  const [enablingWorkflowV2, setEnablingWorkflowV2] = useState(false)
  const templateTarget = context?.target ?? fallbackTarget
  const activeExecutionHostId = activeRun?.executionHostId
  const refreshGeneration = useRef(0)
  const runTarget = useMemo(
    () =>
      activeExecutionHostId
        ? workflowTargetForExecutionHost(activeExecutionHostId)
        : templateTarget,
    [activeExecutionHostId, templateTarget]
  )
  const templateListContext = resolveWorkflowTemplateListContext({
    page,
    activeRun,
    runTarget,
    workspaceTarget: templateTarget,
    workspaceProjectIdentity: context?.projectIdentity
  })
  const templateListTarget = templateListContext.target
  const templateProjectIdentity = templateListContext.projectIdentity

  const refreshTemplates = useCallback(
    async (preferred?: WorkflowTemplateRecord): Promise<void> => {
      const generation = ++refreshGeneration.current
      setLoading(true)
      try {
        const [rows, v2Enabled] = await Promise.all([
          listWorkflowTemplates(templateListTarget, templateProjectIdentity, false),
          getWorkflowV2FeatureEnabled(templateListTarget)
        ])
        if (generation !== refreshGeneration.current) {
          return
        }
        setTemplates(rows)
        setWorkflowV2EnabledState(v2Enabled)
        const currentTemplateId = getWorkflowSelectedTemplate()?.id
        const selected =
          preferred ?? rows.find((template) => template.id === currentTemplateId) ?? rows[0] ?? null
        setWorkflowSelectedTemplate(selected)
      } catch (error) {
        if (generation !== refreshGeneration.current) {
          return
        }
        toast.error(
          error instanceof Error
            ? error.message
            : translate('workflows.errors.loadTemplates', 'Could not load Workflow templates')
        )
      } finally {
        if (generation === refreshGeneration.current) {
          setLoading(false)
        }
      }
    },
    [templateListTarget, templateProjectIdentity]
  )

  useEffect(() => {
    if (page === 'templates' || page === 'application') {
      void refreshTemplates()
    }
    return () => {
      refreshGeneration.current += 1
    }
  }, [page, refreshTemplates])
  const workspaceDrifted = Boolean(
    activeRun && context && activeRun.workspace.id !== context.workspaceId
  )
  const switchTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      if (!activeRun || templateId === activeRun.templateId) {
        return
      }
      setSwitchingTemplate(true)
      try {
        const switched = await switchWorkflowRunTemplate(runTarget, activeRun, templateId)
        setWorkflowPreflight(null)
        setWorkflowActiveRun(switched)
        setWorkflowSelectedTemplate(
          templates.find((template) => template.id === templateId) ?? null
        )
        toast.success(
          translate('workflows.application.templateSwitched', 'Workflow template changed')
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate('workflows.errors.switchTemplate', 'Could not change the Workflow template')
        )
      } finally {
        setSwitchingTemplate(false)
      }
    },
    [activeRun, runTarget, templates]
  )
  const enableWorkflowV2 = useCallback(async (): Promise<void> => {
    setEnablingWorkflowV2(true)
    try {
      const enabled = await setWorkflowV2FeatureEnabled(templateListTarget, true)
      setWorkflowV2EnabledState(enabled)
      toast.success(translate('workflows.v2.enabled', 'Workflow V2 enabled on this host'))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.v2.enableError', 'Could not enable Workflow V2')
      )
    } finally {
      setEnablingWorkflowV2(false)
    }
  }, [templateListTarget])

  if (page === 'application' && activeRun) {
    return (
      <WorkflowPageSurface>
        <WorkflowRunApplicationPage
          run={activeRun}
          target={runTarget}
          preflight={preflight}
          templates={templates}
          templateSwitching={loading || switchingTemplate}
          workspaceLabel={
            context && !workspaceDrifted
              ? `${context.projectName} · ${context.workspaceName}`
              : activeRun.workspace.id
          }
          workspaceDrifted={workspaceDrifted}
          onRunUpdated={setWorkflowActiveRun}
          onPreflightUpdated={setWorkflowPreflight}
          onSwitchTemplate={(templateId) => void switchTemplate(templateId)}
          onSwitchBack={() => {
            const activated = activateAndRevealWorkspace(activeRun.workspace.id)
            if (!activated) {
              toast.error(
                translate(
                  'workflows.errors.workspaceUnavailable',
                  'Draft workspace is no longer available'
                )
              )
            }
          }}
          onBack={() => setWorkflowPage('templates')}
          onStarted={() => {
            setWorkflowPage('runs')
            closeWorkflowsPage()
          }}
        />
      </WorkflowPageSurface>
    )
  }

  if (page === 'runs') {
    return (
      <WorkflowPageSurface className="flex flex-col">
        <PageHeader
          title={translate('workflows.runs.title', 'Workflow runs')}
          description={
            context
              ? `${context.projectName} · ${context.workspaceName}`
              : translate('workflows.runs.description', 'Run history and current results')
          }
          action={
            <Button size="sm" variant="outline" onClick={() => setWorkflowPage('templates')}>
              <LayoutTemplate />
              {translate('workflows.runs.openTemplates', 'Workflow templates')}
            </Button>
          }
        />
        <div className="min-h-0 w-full min-w-0 flex-1">
          <WorkflowRunHistory
            target={runTarget}
            context={context}
            activeRun={activeRun}
            selectedStepRunId={selectedStepRunId}
            onRunUpdated={setWorkflowActiveRun}
            onBackToSetup={() => setWorkflowPage('application')}
          />
        </div>
      </WorkflowPageSurface>
    )
  }

  return (
    <WorkflowPageSurface className={loading ? 'pointer-events-none opacity-70' : undefined}>
      <WorkflowTemplateWorkspace
        templates={templates}
        selected={selectedTemplate}
        target={templateTarget}
        projectIdentity={context?.projectIdentity}
        workflowV2Enabled={workflowV2Enabled}
        enablingWorkflowV2={enablingWorkflowV2}
        onEnableWorkflowV2={() => void enableWorkflowV2()}
        onOpenHistory={() => setWorkflowPage('runs')}
        onTemplatesChanged={refreshTemplates}
      />
    </WorkflowPageSurface>
  )
}

function WorkflowPageSurface({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      data-workflow-page-surface="true"
      className={cn('h-full min-h-0 w-full min-w-0 overflow-hidden bg-background', className)}
    >
      {children}
    </div>
  )
}

function PageHeader({
  title,
  description,
  action
}: {
  title: string
  description: string
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  )
}
