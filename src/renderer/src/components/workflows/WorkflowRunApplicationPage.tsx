import { ArrowLeft, CheckCircle2, Play, ScanSearch } from 'lucide-react'
import type {
  WorkflowPreflightResult,
  WorkflowRunRecord,
  WorkflowTemplateRecord
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { WorkflowAgentAssignmentConfiguration } from './WorkflowAgentAssignmentConfiguration'
import { WorkflowReviewPolicySummary } from './WorkflowReviewPolicySummary'
import { WorkflowRunPolicyConfiguration } from './WorkflowRunPolicyConfiguration'
import { WorkflowRunPromptOverrideFields } from './WorkflowRunPromptOverrides'
import { WorkflowRunPromptPreviews } from './WorkflowRunPromptPreviews'
import { useWorkflowRunApplicationActions } from './use-workflow-run-application-actions'
import {
  workflowAssignableUnits,
  workflowRoleSlots
} from '../../../../shared/workflow-definition-access'

export function WorkflowRunApplicationPage({
  run,
  target,
  preflight,
  templates,
  templateSwitching,
  workspaceLabel,
  workspaceDrifted,
  onRunUpdated,
  onPreflightUpdated,
  onSwitchTemplate,
  onSwitchBack,
  onBack,
  onStarted
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  preflight: WorkflowPreflightResult | null
  templates: readonly WorkflowTemplateRecord[]
  templateSwitching: boolean
  workspaceLabel: string
  workspaceDrifted: boolean
  onRunUpdated: (run: WorkflowRunRecord) => void
  onPreflightUpdated: (result: WorkflowPreflightResult) => void
  onSwitchTemplate: (templateId: string) => void
  onSwitchBack: () => void
  onBack: () => void
  onStarted: () => void
}): React.JSX.Element {
  const { objective, setObjective, policy, setPolicy, prompts, setPrompts, busy, prepare, start } =
    useWorkflowRunApplicationActions({ run, target, onRunUpdated, onPreflightUpdated, onStarted })
  const assignmentProgress = requiredAssignmentProgress(run)

  return (
    <div
      data-workflow-application="true"
      className="scrollbar-sleek h-full w-full min-w-0 overflow-y-auto"
    >
      <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={translate('workflows.application.backToTemplates', 'Back to templates')}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">
                {translate('workflows.application.title', 'Run configuration')}
              </h1>
              <Badge variant={run.status === 'ready' ? 'default' : 'secondary'}>
                {runStatusLabel(run.status)}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {translate('workflows.application.context', '{{value0}} · v{{value1}} · {{value2}}', {
                value0: run.templateName,
                value1: run.templateVersion,
                value2: workspaceLabel
              })}
            </p>
          </div>
        </div>
      </header>

      <div className="grid w-full min-w-0 gap-5 p-5 xl:grid-cols-[minmax(18rem,2fr)_minmax(30rem,3fr)]">
        <div className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <SectionHeading
                title={translate('workflows.application.workflowTemplate', 'Workflow template')}
                description={translate(
                  'workflows.application.workflowTemplateHint',
                  'You can switch templates until the workflow starts. The objective is kept and role assignments are reset.'
                )}
              />
              <Select
                value={run.templateId}
                disabled={templateSwitching || busy || templates.length === 0}
                onValueChange={onSwitchTemplate}
              >
                <SelectTrigger className="w-full shrink-0 sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 px-4 py-4">
              <SectionHeading
                title={translate('workflows.application.objective', 'Task objective')}
                description={translate(
                  'workflows.application.objectiveHint',
                  'Describe the result this run should complete. The template itself will not be changed.'
                )}
              />
              <Textarea
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder={translate(
                  'workflows.activity.objectivePlaceholder',
                  'Describe the Workflow root objective in Markdown'
                )}
                aria-label={translate(
                  'workflows.activity.objectiveAria',
                  'Workflow task objective'
                )}
                className="min-h-28"
              />
            </div>
          </section>
          {run.templateSnapshot.schemaVersion === 1 ? (
            <WorkflowReviewPolicySummary definition={run.templateSnapshot} />
          ) : null}
          <WorkflowRunPolicyConfiguration run={run} value={policy} onChange={setPolicy} />
          <WorkflowRunPromptOverrideFields run={run} value={prompts} onChange={setPrompts} />
          <WorkflowRunPromptPreviews previews={preflight?.promptPreviews ?? []} />
        </div>

        <div className="min-w-0">
          <ConfigurationSection
            title={translate('workflows.application.assignAgents', 'Assign Agents')}
            description={translate(
              'workflows.application.assignAgentsHint',
              'Choose or create an Agent for each required role, or drag an idle one from Agent Activity.'
            )}
          >
            <WorkflowAgentAssignmentConfiguration
              run={run}
              target={target}
              preflight={preflight}
              workspaceDrifted={workspaceDrifted}
              onRunUpdated={onRunUpdated}
              onSwitchBack={onSwitchBack}
            />
          </ConfigurationSection>
        </div>
      </div>

      <footer className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {run.status === 'ready' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-success" />
            ) : (
              <ScanSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium">
                {translate('workflows.application.checkAndStart', 'Check and start')}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {run.status === 'ready'
                  ? translate(
                      'workflows.application.readyHint',
                      'All run checks passed. Starting will send the first Agent task.'
                    )
                  : translate(
                      'workflows.activity.assignmentProgress',
                      '{{value0}} / {{value1}} required roles assigned',
                      {
                        value0: assignmentProgress.assigned,
                        value1: assignmentProgress.required
                      }
                    )}
              </p>
            </div>
          </div>
          {run.status === 'ready' ? (
            <Button disabled={busy || workspaceDrifted} onClick={() => void start()}>
              <Play />
              {translate('workflows.application.start', 'Start workflow')}
            </Button>
          ) : (
            <Button disabled={busy || workspaceDrifted} onClick={() => void prepare()}>
              <ScanSearch />
              {translate('workflows.application.check', 'Check run readiness')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

function ConfigurationSection({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <SectionHeading title={title} description={description} />
      <div>{children}</div>
    </section>
  )
}

function SectionHeading({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function requiredAssignmentProgress(run: WorkflowRunRecord): {
  assigned: number
  required: number
} {
  const requiredSlots = new Map(
    workflowRoleSlots(run.templateSnapshot)
      .filter((slot) => slot.required)
      .map((slot) => [slot.id, slot])
  )
  const assignmentCounts = new Map<string, number>()
  for (const assignment of run.assignments) {
    const key = `${assignment.nodeId}\u0000${assignment.slotId}`
    assignmentCounts.set(key, (assignmentCounts.get(key) ?? 0) + 1)
  }
  let assigned = 0
  let required = 0
  for (const node of workflowAssignableUnits(run.templateSnapshot)) {
    for (const slotId of node.roleSlotIds) {
      const slot = requiredSlots.get(slotId)
      if (!slot) {
        continue
      }
      const count = assignmentCounts.get(`${node.id}\u0000${slotId}`) ?? 0
      assigned += Math.min(count, slot.minAgents)
      required += slot.minAgents
    }
  }
  return { assigned, required }
}

function runStatusLabel(status: WorkflowRunRecord['status']): string {
  if (status === 'ready') {
    return translate('workflows.application.ready', 'Ready')
  }
  return translate('workflows.application.configuring', 'Configuring')
}
