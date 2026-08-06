import type { WorkflowRouteV2 } from '../../../../shared/workflow-definition-v2-types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

export function WorkflowV2RouteFields({
  label,
  route,
  stepIds,
  recoveryStepIds,
  readOnly,
  onChange
}: {
  label: string
  route: WorkflowRouteV2
  stepIds: string[]
  recoveryStepIds: string[]
  readOnly: boolean
  onChange: (route: WorkflowRouteV2) => void
}): React.JSX.Element {
  return (
    <section className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
      <SelectField
        label={label}
        value={route.targetStepId}
        options={stepIds}
        disabled={readOnly}
        onChange={(targetStepId) => onChange({ ...route, targetStepId })}
      />
      <label className="space-y-1">
        <Label className="text-xs">
          {translate('workflows.visual.maxTraversals', 'Max traversals')}
        </Label>
        <Input
          type="number"
          min={0}
          max={50}
          value={route.maxTraversals ?? ''}
          disabled={readOnly}
          className="h-8 text-xs"
          onChange={(event) => {
            const raw = event.target.value
            onChange({
              ...route,
              maxTraversals: raw === '' ? undefined : Math.min(50, Math.max(0, Number(raw) || 0))
            })
          }}
        />
      </label>
      <SelectField
        label={translate('workflows.visual.exhaustedTarget', 'Exhausted target')}
        value={route.onExhaustedStepId ?? 'none'}
        options={['none', ...recoveryStepIds]}
        disabled={readOnly}
        onChange={(onExhaustedStepId) =>
          onChange({
            ...route,
            onExhaustedStepId: onExhaustedStepId === 'none' ? undefined : onExhaustedStepId
          })
        }
      />
    </section>
  )
}

export function SelectField({
  label,
  value,
  options,
  optionLabels,
  disabled,
  onChange
}: {
  label: string
  value: string
  options: string[]
  optionLabels?: Readonly<Record<string, string>>
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabels?.[option] ?? option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
