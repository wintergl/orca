import type { WorkflowTemplateSnapshot } from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { WorkflowTemplateV2Editor } from './WorkflowTemplateV2Editor'
import { WorkflowTemplateVisualEditor } from './WorkflowTemplateVisualEditor'

type WorkflowTemplateEditorDraft = {
  kind: 'new' | 'existing'
  templateId: string | null
  expectedVersion: number | null
  definition: WorkflowTemplateSnapshot
}

export function WorkflowTemplateDefinitionSurface({
  draft,
  readOnly,
  workflowV2Blocked,
  activeRunCount,
  enablingWorkflowV2,
  onEnableWorkflowV2,
  onOpenHistory,
  onChange
}: {
  draft: WorkflowTemplateEditorDraft | null
  readOnly: boolean
  workflowV2Blocked: boolean
  activeRunCount: number
  enablingWorkflowV2: boolean
  onEnableWorkflowV2: () => void
  onOpenHistory: () => void
  onChange: (definition: WorkflowTemplateSnapshot) => void
}): React.JSX.Element {
  if (!draft) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {translate('workflows.templates.select', 'Select a workflow template')}
        </p>
      </main>
    )
  }
  return (
    <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      {workflowV2Blocked ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-2"
        >
          <p className="text-xs text-muted-foreground">
            {translate(
              'workflows.v2.disabledDescription',
              'This V2 template is view-only until Workflow V2 is enabled on this runtime host.'
            )}
          </p>
          <Button
            size="xs"
            variant="outline"
            disabled={enablingWorkflowV2}
            onClick={onEnableWorkflowV2}
          >
            {enablingWorkflowV2
              ? translate('workflows.v2.enabling', 'Enabling…')
              : translate('workflows.v2.enable', 'Enable Workflow V2')}
          </Button>
        </div>
      ) : null}
      {activeRunCount > 0 ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-2"
        >
          <p className="text-xs text-muted-foreground">
            {translate(
              'workflows.templates.activeRunLock',
              'Editing is locked while {{value0}} run(s) are active. Actual delivered prompts remain available in Run history.',
              { value0: activeRunCount }
            )}
          </p>
          <Button size="xs" variant="outline" onClick={onOpenHistory}>
            {translate('workflows.templates.openPromptHistory', 'Open prompt history')}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {draft.definition.schemaVersion === 2 ? (
          <WorkflowTemplateV2Editor
            key={`${draft.kind}:${draft.templateId ?? 'new'}:${draft.expectedVersion ?? 0}:v2`}
            definition={draft.definition}
            readOnly={readOnly}
            onChange={onChange}
          />
        ) : (
          <WorkflowTemplateVisualEditor
            key={`${draft.kind}:${draft.templateId ?? 'new'}:${draft.expectedVersion ?? 0}`}
            definition={draft.definition}
            readOnly={readOnly}
            onChange={onChange}
          />
        )}
      </div>
    </main>
  )
}
