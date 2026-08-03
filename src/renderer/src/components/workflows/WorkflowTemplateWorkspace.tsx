import { useEffect, useState } from 'react'
import { FolderCog, History, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowTemplateRecord,
  WorkflowTemplateScope,
  WorkflowTemplateSnapshot
} from '../../../../shared/workflow-definition-types'
import { parseWorkflowDefinitionV1 } from '../../../../shared/workflow-definition-schema'
import { parseWorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-schema'
import { validateWorkflowPromptBoundaries } from '../../../../shared/workflow-prompt-boundary-validation'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  archiveWorkflowTemplate,
  cloneWorkflowTemplate,
  createWorkflowTemplate,
  updateWorkflowTemplate
} from './workflow-runtime-client'
import { setWorkflowSelectedTemplate } from './workflow-renderer-state'
import {
  createBlankWorkflowDefinition,
  isBlankWorkflowCreationEnabled
} from './workflow-template-draft'
import { WorkflowTemplateManager } from './WorkflowTemplateManager'
import { WorkflowTemplateDefinitionSurface } from './WorkflowTemplateDefinitionSurface'
import { WorkflowTemplateSelectGroups } from './WorkflowTemplateSelectGroups'

type EditorDraft = {
  kind: 'new' | 'existing'
  templateId: string | null
  expectedVersion: number | null
  name: string
  scope: Exclude<WorkflowTemplateScope, 'built-in'>
  definition: WorkflowTemplateSnapshot
}

export function WorkflowTemplateWorkspace({
  templates,
  selected,
  target,
  projectIdentity,
  workflowV2Enabled,
  enablingWorkflowV2,
  onEnableWorkflowV2,
  onOpenHistory,
  onTemplatesChanged
}: {
  templates: readonly WorkflowTemplateRecord[]
  selected: WorkflowTemplateRecord | null
  target: RuntimeClientTarget
  projectIdentity?: string
  workflowV2Enabled: boolean | null
  enablingWorkflowV2: boolean
  onEnableWorkflowV2: () => void
  onOpenHistory: () => void
  onTemplatesChanged: (selectedTemplate?: WorkflowTemplateRecord) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const workflowV2Blocked = workflowV2Enabled === false && draft?.definition.schemaVersion === 2
  const activeRunCount =
    draft?.kind === 'existing'
      ? (templates.find((template) => template.id === draft.templateId)?.activeRunCount ?? 0)
      : 0
  const draftReadOnly = workflowV2Blocked || activeRunCount > 0

  useEffect(() => {
    if (selected) {
      setDraft(toExistingDraft(selected))
    }
  }, [selected])

  const startNew = (): void => {
    if (
      !isBlankWorkflowCreationEnabled({
        'workflows.v2.enabled': workflowV2Enabled === true
      })
    ) {
      toast.info(
        translate(
          'workflows.templates.blankRequiresV2',
          'Blank workflows require the V2 feature gate. Clone a runnable built-in template instead.'
        )
      )
      return
    }
    setWorkflowSelectedTemplate(null)
    setDraft({
      kind: 'new',
      templateId: null,
      expectedVersion: null,
      name: translate('workflows.templates.untitled', 'Untitled workflow'),
      scope: projectIdentity ? 'project' : 'personal',
      definition: createBlankWorkflowDefinition({ 'workflows.v2.enabled': true })
    })
  }

  const openTemplate = (template: WorkflowTemplateRecord): void => {
    setWorkflowSelectedTemplate(template)
    setDraft(toExistingDraft(template))
  }

  const save = async (): Promise<void> => {
    if (!draft) {
      return
    }
    try {
      if (draft.definition.schemaVersion === 2) {
        parseWorkflowDefinitionV2(draft.definition)
      } else {
        parseWorkflowDefinitionV1(draft.definition)
      }
      const promptIssues = validateWorkflowPromptBoundaries(draft.definition)
      if (promptIssues.length) {
        throw new Error(promptIssues.map((issue) => `${issue.nodeId}: ${issue.message}`).join('; '))
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.templates.invalidDefinition', 'Workflow definition is invalid')
      )
      return
    }
    setSaving(true)
    try {
      const saved =
        draft.kind === 'new'
          ? await createWorkflowTemplate(target, {
              name: draft.name,
              scope: draft.scope,
              projectIdentity: draft.scope === 'project' ? projectIdentity : undefined,
              definition: draft.definition
            })
          : await updateWorkflowTemplate(target, {
              templateId: draft.templateId!,
              expectedVersion: draft.expectedVersion!,
              name: draft.name,
              projectIdentity,
              definition: draft.definition
            })
      setWorkflowSelectedTemplate(saved)
      setDraft(toExistingDraft(saved))
      await onTemplatesChanged(saved)
      toast.success(
        translate('workflows.templates.savedVersion', 'Saved template v{{value0}}', {
          value0: saved.currentVersion
        })
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.errors.saveTemplate', 'Could not save template')
      )
    } finally {
      setSaving(false)
    }
  }

  const copyTemplate = async (template: WorkflowTemplateRecord): Promise<void> => {
    try {
      const copied = await cloneWorkflowTemplate(target, {
        sourceTemplateId: template.id,
        sourceProjectIdentity: template.projectIdentity ?? undefined,
        name: translate('workflows.templates.copyName', '{{value0}} copy', {
          value0: template.name
        }),
        scope: projectIdentity ? 'project' : 'personal',
        projectIdentity
      })
      setWorkflowSelectedTemplate(copied)
      setDraft(toExistingDraft(copied))
      setManagerOpen(false)
      await onTemplatesChanged(copied)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.errors.copyTemplate', 'Could not copy template')
      )
    }
  }

  const archiveTemplate = async (template: WorkflowTemplateRecord): Promise<void> => {
    if (template.scope === 'built-in') {
      return
    }
    try {
      await archiveWorkflowTemplate(
        target,
        template.id,
        template.projectIdentity ?? projectIdentity
      )
      if (selected?.id === template.id) {
        setWorkflowSelectedTemplate(null)
        setDraft(null)
      }
      await onTemplatesChanged()
      toast.success(translate('workflows.templates.archived', 'Template archived'))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.errors.archiveTemplate', 'Could not archive template')
      )
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Select
            value={selected?.id ?? ''}
            onValueChange={(templateId) =>
              setWorkflowSelectedTemplate(
                templates.find((template) => template.id === templateId) ?? null
              )
            }
          >
            <SelectTrigger
              className="w-[min(22rem,42vw)] border-0 bg-transparent px-1 text-sm font-semibold shadow-none"
              aria-label={translate('workflows.activity.chooseWorkflow', 'Choose workflow')}
            >
              <SelectValue
                placeholder={translate('workflows.templates.select', 'Select a workflow template')}
              />
            </SelectTrigger>
            <SelectContent>
              <WorkflowTemplateSelectGroups templates={templates} />
            </SelectContent>
          </Select>
          {selected ? (
            <Badge variant="secondary" className="hidden xl:inline-flex">
              v{selected.currentVersion}
            </Badge>
          ) : null}
          <Badge variant="outline" className="hidden xl:inline-flex">
            {selected ? scopeLabel(selected.scope) : draft?.scope}
          </Badge>
          {draft?.kind === 'new' ? (
            <Input
              value={draft.name}
              className="h-8 max-w-64"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onOpenHistory}>
            <History />
            <span>{translate('workflows.history.title', 'Run history')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={translate('workflows.templates.manageTitle', 'Workflow management')}
            onClick={() => setManagerOpen(true)}
          >
            <FolderCog />
            <span>{translate('workflows.templates.manage', 'Manage')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={translate('workflows.templates.validate', 'Validate')}
            disabled={!draft}
            onClick={() => {
              if (!draft) {
                return
              }
              try {
                if (draft.definition.schemaVersion === 2) {
                  parseWorkflowDefinitionV2(draft.definition)
                } else {
                  parseWorkflowDefinitionV1(draft.definition)
                }
                const issues = validateWorkflowPromptBoundaries(draft.definition)
                if (issues.length) {
                  throw new Error(
                    issues.map((issue) => `${issue.nodeId}: ${issue.message}`).join('; ')
                  )
                }
                toast.success(
                  translate('workflows.templates.valid', 'Workflow definition is valid')
                )
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : translate(
                        'workflows.templates.invalidDefinition',
                        'Workflow definition is invalid'
                      )
                )
              }
            }}
          >
            <ShieldCheck />
            <span className="hidden xl:inline">
              {translate('workflows.templates.validate', 'Validate')}
            </span>
          </Button>
          {draft && !draftReadOnly ? (
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              <Save />
              {saving
                ? translate('workflows.templates.saving', 'Saving…')
                : translate('workflows.templates.saveVersion', 'Save')}
            </Button>
          ) : null}
        </div>
      </header>
      <WorkflowTemplateDefinitionSurface
        draft={draft}
        readOnly={draftReadOnly}
        workflowV2Blocked={workflowV2Blocked}
        activeRunCount={activeRunCount}
        enablingWorkflowV2={enablingWorkflowV2}
        onEnableWorkflowV2={onEnableWorkflowV2}
        onOpenHistory={onOpenHistory}
        onChange={(definition) => draft && setDraft({ ...draft, definition })}
      />
      <WorkflowTemplateManager
        open={managerOpen}
        templates={templates}
        selectedTemplateId={selected?.id ?? null}
        onOpenChange={setManagerOpen}
        onNew={startNew}
        onOpen={openTemplate}
        onCopy={copyTemplate}
        onArchive={archiveTemplate}
      />
    </div>
  )
}

function toExistingDraft(template: WorkflowTemplateRecord): EditorDraft {
  return {
    kind: 'existing',
    templateId: template.id,
    expectedVersion: template.currentVersion,
    name: template.name,
    scope: template.scope === 'built-in' ? 'personal' : template.scope,
    definition: template.definition
  }
}

function scopeLabel(scope: WorkflowTemplateScope): string {
  switch (scope) {
    case 'built-in':
      return translate('workflows.scope.builtin', 'Built-in')
    case 'personal':
      return translate('workflows.scope.personal', 'Personal')
    case 'project':
      return translate('workflows.scope.project', 'Project')
  }
}
