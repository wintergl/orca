import { Plus, Trash2 } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export function WorkflowV2RoleSlotFields({
  definition,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV2
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV2) => void
}): React.JSX.Element {
  const referenced = new Set(
    definition.steps.flatMap((step) =>
      step.kind === 'agent' || step.kind === 'decision' ? step.roleSlotIds : []
    )
  )
  const update = (
    roleId: string,
    patch: Partial<WorkflowDefinitionV2['roleSlots'][number]>
  ): void => {
    onChange({
      ...definition,
      roleSlots: definition.roleSlots.map((role) =>
        role.id === roleId ? normalizeRole({ ...role, ...patch }) : role
      )
    })
  }
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">
            {translate('workflows.visual.roles', 'Agent roles')}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'workflows.visual.rolesHint',
              'Stable role IDs define assignment capacity and execution behavior.'
            )}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={readOnly}
          onClick={() =>
            onChange({ ...definition, roleSlots: [...definition.roleSlots, newRole(definition)] })
          }
        >
          <Plus /> {translate('workflows.visual.addRole', 'Add role')}
        </Button>
      </div>
      <div className="space-y-2">
        {definition.roleSlots.map((role) => (
          <article key={role.id} className="rounded-md border border-border p-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_5rem_5rem_minmax(7rem,1fr)_auto]">
              <label className="space-y-1">
                <Label className="text-[11px]">{role.id}</Label>
                <Input
                  value={role.label}
                  disabled={readOnly}
                  className="h-8 text-xs"
                  onChange={(event) => update(role.id, { label: event.target.value })}
                />
              </label>
              <NumberInput
                label={translate('workflows.visual.minAgents', 'Min')}
                value={role.minAgents}
                disabled={readOnly}
                onChange={(minAgents) => update(role.id, { minAgents })}
              />
              <NumberInput
                label={translate('workflows.visual.maxAgents', 'Max')}
                value={role.maxAgents}
                disabled={readOnly}
                onChange={(maxAgents) => update(role.id, { maxAgents })}
              />
              <label className="space-y-1">
                <Label className="text-[11px]">
                  {translate('workflows.visual.execution', 'Execution')}
                </Label>
                <Select
                  value={role.execution}
                  disabled={readOnly}
                  onValueChange={(execution) =>
                    update(role.id, {
                      execution: execution as typeof role.execution,
                      maxAgents: execution === 'single' ? 1 : role.maxAgents
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['single', 'parallel', 'sequential'] as const).map((value) => (
                      <SelectItem key={value} value={value}>
                        {executionLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <Button
                size="icon-xs"
                variant="ghost"
                className="self-end"
                disabled={readOnly || referenced.has(role.id) || definition.roleSlots.length <= 1}
                aria-label={translate('workflows.visual.removeRole', 'Remove role')}
                onClick={() =>
                  onChange({
                    ...definition,
                    roleSlots: definition.roleSlots.filter((candidate) => candidate.id !== role.id)
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={role.required}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  update(role.id, {
                    required: checked === true,
                    minAgents: checked === true ? Math.max(1, role.minAgents) : 0
                  })
                }
              />
              {translate('workflows.visual.requiredRole', 'Required role')}
            </label>
          </article>
        ))}
      </div>
    </section>
  )
}

function NumberInput({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        min={0}
        max={8}
        value={value}
        disabled={disabled}
        className="h-8 text-xs"
        onChange={(event) => onChange(Math.max(0, Math.min(8, Number(event.target.value) || 0)))}
      />
    </label>
  )
}

function normalizeRole(
  role: WorkflowDefinitionV2['roleSlots'][number]
): WorkflowDefinitionV2['roleSlots'][number] {
  const maxAgents = role.execution === 'single' ? 1 : Math.max(1, role.maxAgents)
  const minAgents = role.required ? Math.max(1, role.minAgents) : 0
  return { ...role, minAgents: Math.min(minAgents, maxAgents), maxAgents }
}

function newRole(definition: WorkflowDefinitionV2): WorkflowDefinitionV2['roleSlots'][number] {
  let index = definition.roleSlots.length + 1
  while (definition.roleSlots.some((role) => role.id === `role-${index}`)) {
    index += 1
  }
  return {
    id: `role-${index}`,
    label: translate('workflows.visual.roleNumber', 'Role {{count}}', { count: index }),
    required: true,
    minAgents: 1,
    maxAgents: 1,
    execution: 'single',
    allowedAgentStates: ['idle']
  }
}

function executionLabel(value: 'single' | 'parallel' | 'sequential'): string {
  if (value === 'single') {
    return translate('workflows.visual.executionSingle', 'Single')
  }
  if (value === 'parallel') {
    return translate('workflows.visual.executionParallel', 'Parallel')
  }
  return translate('workflows.visual.executionSequential', 'Sequential')
}
