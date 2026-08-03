import type {
  WorkflowRunRecord,
  WorkflowTemplateRecord
} from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  workflowAssignableUnits,
  workflowRoleSlots
} from '../../../../shared/workflow-definition-access'

export function WorkflowActivityLauncher({
  templates,
  selectedTemplate,
  workspaceLabel,
  disabled,
  onSelect,
  onConfigure,
  onOpenTemplates
}: {
  templates: readonly WorkflowTemplateRecord[]
  selectedTemplate: WorkflowTemplateRecord | null
  workspaceLabel: string
  disabled: boolean
  onSelect: (templateId: string) => void
  onConfigure: () => void
  onOpenTemplates: () => void
}): React.JSX.Element {
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
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue
              placeholder={translate('workflows.activity.noTemplates', 'No workflows available')}
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Button size="xs" disabled={disabled} onClick={onConfigure}>
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
