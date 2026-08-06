import type { WorkflowTemplateRecord } from '../../../../shared/workflow-definition-types'
import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

export function WorkflowTemplateSelectGroups({
  templates
}: {
  templates: readonly WorkflowTemplateRecord[]
}): React.JSX.Element {
  const v2Templates = templates.filter((template) => template.definition.schemaVersion === 2)
  return (
    <WorkflowTemplateSelectGroup
      label={translate('workflows.templates.configurations', 'Workflow configurations')}
      templates={v2Templates}
    />
  )
}

function WorkflowTemplateSelectGroup({
  label,
  templates
}: {
  label: string
  templates: readonly WorkflowTemplateRecord[]
}): React.JSX.Element | null {
  if (templates.length === 0) {
    return null
  }
  return (
    <SelectGroup>
      <SelectLabel data-workflow-template-group="v2">{label}</SelectLabel>
      {templates.map((template) => (
        <SelectItem key={template.id} value={template.id}>
          {template.name}
        </SelectItem>
      ))}
    </SelectGroup>
  )
}
