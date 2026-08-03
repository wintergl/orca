import type {
  WorkflowRunRecord,
  WorkflowTemplateRecord
} from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  workflowAssignableUnits,
  workflowRoleSlots
} from '../../../../shared/workflow-definition-access'
import { WorkflowTemplateSelectGroups } from './WorkflowTemplateSelectGroups'

export function WorkflowActivityLauncher({
  templates,
  selectedTemplate,
  workspaceLabel,
  workflowV2Enabled,
  enablingWorkflowV2,
  disabled,
  onSelect,
  onConfigure,
  onEnableWorkflowV2,
  onOpenTemplates
}: {
  templates: readonly WorkflowTemplateRecord[]
  selectedTemplate: WorkflowTemplateRecord | null
  workspaceLabel: string
  workflowV2Enabled: boolean | null
  enablingWorkflowV2: boolean
  disabled: boolean
  onSelect: (templateId: string) => void
  onConfigure: () => void
  onEnableWorkflowV2: () => void
  onOpenTemplates: () => void
}): React.JSX.Element {
  const workflowV2Blocked =
    selectedTemplate?.definition.schemaVersion === 2 && workflowV2Enabled === false
  return (
    <>
      <div>
        <p className="text-[10px] text-muted-foreground">
          {translate('workflows.activity.currentWorkspace', 'Current workspace')}
        </p>
        <p className="truncate text-[11px] font-medium text-sidebar-foreground">{workspaceLabel}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-[10px] text-muted-foreground">
          {translate('workflows.activity.chooseWorkflow', 'Choose workflow')}
        </span>
        <Select value={selectedTemplate?.id} disabled={!templates.length} onValueChange={onSelect}>
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={translate('workflows.activity.chooseWorkflow', 'Choose workflow')}
          >
            <SelectValue
              placeholder={translate('workflows.activity.noTemplates', 'No workflows available')}
            />
          </SelectTrigger>
          <SelectContent>
            <WorkflowTemplateSelectGroups templates={templates} />
          </SelectContent>
        </Select>
      </label>
      {workflowV2Blocked ? (
        <div role="status" className="space-y-2 rounded-md border border-sidebar-border p-2">
          <p className="text-[10px] text-muted-foreground">
            {translate(
              'workflows.v2.disabledDescription',
              'This V2 template is view-only until Workflow V2 is enabled on this runtime host.'
            )}
          </p>
          <Button
            size="xs"
            variant="outline"
            className="w-full"
            disabled={enablingWorkflowV2}
            onClick={onEnableWorkflowV2}
          >
            {enablingWorkflowV2
              ? translate('workflows.v2.enabling', 'Enabling…')
              : translate('workflows.v2.enable', 'Enable Workflow V2')}
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Button size="xs" disabled={disabled || workflowV2Blocked} onClick={onConfigure}>
          {translate('workflows.activity.configureRun', 'Configure and run')}
        </Button>
        <Button size="xs" variant="outline" onClick={onOpenTemplates}>
          {translate('workflows.activity.templates', 'Templates')}
        </Button>
      </div>
    </>
  )
}

export function WorkflowRunConfigurationSummary({
  run,
  onContinue
}: {
  run: WorkflowRunRecord
  onContinue: () => void
}): React.JSX.Element {
  const assignedRoles = new Set(
    run.assignments.map((assignment) => `${assignment.nodeId}:${assignment.slotId}`)
  ).size
  const requiredSlots = new Set(
    workflowRoleSlots(run.templateSnapshot)
      .filter((slot) => slot.required)
      .map((slot) => slot.id)
  )
  const requiredRoles = workflowAssignableUnits(run.templateSnapshot).reduce(
    (total, node) => total + node.roleSlotIds.filter((slotId) => requiredSlots.has(slotId)).length,
    0
  )
  return (
    <>
      <div>
        <p className="truncate text-[11px] font-medium text-sidebar-foreground">
          {run.templateName}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {run.status === 'ready'
            ? translate('workflows.activity.readyToStart', 'Checks passed · ready to start')
            : translate(
                'workflows.activity.assignmentProgress',
                '{{value0}} / {{value1}} required roles assigned',
                { value0: assignedRoles, value1: requiredRoles }
              )}
        </p>
      </div>
      <Button size="xs" className="w-full" onClick={onContinue}>
        {translate('workflows.activity.continueConfiguration', 'Continue configuration')}
      </Button>
    </>
  )
}
