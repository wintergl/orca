import type { WorkflowTemplateRecord } from '../../../../shared/workflow-definition-types'
import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

export function WorkflowTemplateSelectGroups({
  templates
}: {
  templates: readonly WorkflowTemplateRecord[]
}): React.JSX.Element {
  const v1Templates = templates.filter((template) => template.definition.schemaVersion === 1)
  const v2Templates = templates.filter((template) => template.definition.schemaVersion === 2)
  return (
    <>
      <WorkflowTemplateSelectGroup
        schemaVersion="v1"
        label={translate('workflows.templates.v1Group', 'V1 · Stable workflows')}
        templates={v1Templates}
      />
      <WorkflowTemplateSelectGroup
        schemaVersion="v2"
        label={translate('workflows.templates.v2Group', 'V2 · Free-form workflows')}
        templates={v2Templates}
      />
    </>
  )
}

function WorkflowTemplateSelectGroup({
  schemaVersion,
  label,
  templates
}: {
  schemaVersion: 'v1' | 'v2'
  label: string
  templates: readonly WorkflowTemplateRecord[]
}): React.JSX.Element | null {
  if (templates.length === 0) {
    return null
  }
  return (
    <SelectGroup>
      <SelectLabel data-workflow-template-group={schemaVersion}>{label}</SelectLabel>
      {templates.map((template) => (
        <SelectItem key={template.id} value={template.id}>
          {template.name}
        </SelectItem>
      ))}
    </SelectGroup>
  )
}
