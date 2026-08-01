import { Plus, Trash2 } from 'lucide-react'
import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
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
import {
  addWorkflowRoleSlot,
  removeWorkflowRoleSlot,
  updateWorkflowRoleSlot
} from './workflow-definition-editing'

export function WorkflowRoleRequirementsEditor({
  definition,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV1
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV1) => void
}): React.JSX.Element {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {translate('workflows.visual.roles', 'Role requirements')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {translate(
              'workflows.visual.rolesHint',
              'Roles describe required Agent capacity. Runtime Agent assignments remain separate.'
            )}
          </p>
        </div>
        {!readOnly ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => onChange(addWorkflowRoleSlot(definition).definition)}
          >
            <Plus />
            {translate('workflows.visual.addRole', 'Add role')}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {definition.roleSlots.map((slot) => {
          const usedBy = definition.nodes.filter((node) => node.roleSlotIds.includes(slot.id))
          return (
            <div key={slot.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={slot.label}
                  readOnly={readOnly}
                  aria-label={translate('workflows.visual.roleName', 'Role name')}
                  onChange={(event) =>
                    onChange(
                      updateWorkflowRoleSlot(definition, slot.id, (current) => ({
                        ...current,
                        label: event.target.value
                      }))
                    )
                  }
                />
                {!readOnly ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={translate('workflows.visual.deleteRole', 'Delete role')}
                    onClick={() => onChange(removeWorkflowRoleSlot(definition, slot.id))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label={translate('workflows.visual.minAgents', 'Minimum Agents')}
                  value={slot.minAgents}
                  disabled={readOnly}
                  onChange={(minAgents) =>
                    onChange(
                      updateWorkflowRoleSlot(definition, slot.id, (current) => ({
                        ...current,
                        minAgents
                      }))
                    )
                  }
                />
                <NumberField
                  label={translate('workflows.visual.maxAgents', 'Maximum Agents')}
                  value={slot.maxAgents}
                  disabled={readOnly || slot.execution === 'single'}
                  onChange={(maxAgents) =>
                    onChange(
                      updateWorkflowRoleSlot(definition, slot.id, (current) => ({
                        ...current,
                        maxAgents
                      }))
                    )
                  }
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-medium">
                    {translate('workflows.visual.execution', 'Execution')}
                  </span>
                  <Select
                    value={slot.execution}
                    disabled={readOnly}
                    onValueChange={(execution) =>
                      onChange(
                        updateWorkflowRoleSlot(definition, slot.id, (current) => ({
                          ...current,
                          execution: execution as typeof current.execution,
                          maxAgents: execution === 'single' ? 1 : current.maxAgents
                        }))
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">
                        {translate('workflows.visual.single', 'Single')}
                      </SelectItem>
                      <SelectItem value="parallel">
                        {translate('workflows.visual.parallel', 'Parallel')}
                      </SelectItem>
                      <SelectItem value="sequential">
                        {translate('workflows.visual.sequential', 'Sequential')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <Label className="h-9">
                  <Checkbox
                    checked={slot.required}
                    disabled={readOnly}
                    onCheckedChange={(checked) =>
                      onChange(
                        updateWorkflowRoleSlot(definition, slot.id, (current) => ({
                          ...current,
                          required: checked === true,
                          minAgents: checked === true ? Math.max(1, current.minAgents) : 0
                        }))
                      )
                    }
                  />
                  {translate('workflows.visual.required', 'Required')}
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {usedBy.length > 0
                  ? translate('workflows.visual.usedBy', 'Used by: {{value0}}', {
                      value0: usedBy.map((node) => node.name).join(', ')
                    })
                  : translate('workflows.visual.unusedRole', 'Not assigned to a node')}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function NumberField({
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
      <span className="text-xs font-medium">{label}</span>
      <Input
        type="number"
        min={0}
        max={8}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
