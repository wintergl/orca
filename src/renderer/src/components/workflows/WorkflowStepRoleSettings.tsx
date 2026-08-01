import { Plus, X } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowRoleSlot
} from '../../../../shared/workflow-definition-types'
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
  updateWorkflowNode,
  updateWorkflowRoleSlot
} from './workflow-definition-editing'

export function WorkflowStepRoleSettings({
  definition,
  node,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV1) => void
}): React.JSX.Element {
  if (node.type === 'complete') {
    return (
      <p className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {translate('workflows.visual.completeHasNoRole', 'The final step does not need an Agent.')}
      </p>
    )
  }

  const assigned = definition.roleSlots.filter((slot) => node.roleSlotIds.includes(slot.id))
  const available = definition.roleSlots.filter((slot) => !node.roleSlotIds.includes(slot.id))

  const assignRole = (slotId: string): void => {
    onChange(
      updateWorkflowNode(definition, node.id, (current) => ({
        ...current,
        roleSlotIds: [...current.roleSlotIds, slotId]
      }))
    )
  }

  const createRole = (): void => {
    const added = addWorkflowRoleSlot(definition)
    const namedDefinition = updateWorkflowRoleSlot(added.definition, added.slotId, (slot) => ({
      ...slot,
      label: translate('workflows.visual.newRoleName', 'New role')
    }))
    onChange(
      updateWorkflowNode(namedDefinition, node.id, (current) => ({
        ...current,
        roleSlotIds: [...current.roleSlotIds, added.slotId]
      }))
    )
  }

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-medium">
          {translate('workflows.visual.executionRoles', 'Execution roles')}
        </h4>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {translate(
            'workflows.visual.executionRolesHint',
            'Describe the role needed here. Choose the actual Agent when the workflow runs.'
          )}
        </p>
      </div>

      {assigned.map((slot) => (
        <RoleCard
          key={slot.id}
          definition={definition}
          node={node}
          slot={slot}
          readOnly={readOnly}
          onChange={onChange}
        />
      ))}

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {available.length ? (
            <Select onValueChange={assignRole}>
              <SelectTrigger className="w-52">
                <SelectValue
                  placeholder={translate('workflows.visual.chooseExistingRole', 'Choose a role')}
                />
              </SelectTrigger>
              <SelectContent>
                {available.map((slot) => (
                  <SelectItem key={slot.id} value={slot.id}>
                    {slot.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button size="sm" variant="outline" onClick={createRole}>
            <Plus />
            {translate('workflows.visual.createRole', 'Create role')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function RoleCard({
  definition,
  node,
  slot,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  slot: WorkflowRoleSlot
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV1) => void
}): React.JSX.Element {
  const updateSlot = (update: (current: WorkflowRoleSlot) => WorkflowRoleSlot): void => {
    onChange(updateWorkflowRoleSlot(definition, slot.id, update))
  }

  const detach = (): void => {
    onChange(
      updateWorkflowNode(definition, node.id, (current) => ({
        ...current,
        roleSlotIds: current.roleSlotIds.filter((slotId) => slotId !== slot.id)
      }))
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={slot.label}
          readOnly={readOnly}
          aria-label={translate('workflows.visual.roleName', 'Role name')}
          onChange={(event) => updateSlot((current) => ({ ...current, label: event.target.value }))}
        />
        {!readOnly ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={translate('workflows.visual.detachRole', 'Remove role from this step')}
            onClick={detach}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium">
            {translate('workflows.visual.execution', 'Working mode')}
          </span>
          <Select
            value={slot.execution}
            disabled={readOnly}
            onValueChange={(execution) =>
              updateSlot((current) => ({
                ...current,
                execution: execution as WorkflowRoleSlot['execution'],
                maxAgents: execution === 'single' ? 1 : current.maxAgents
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">
                {translate('workflows.visual.single', 'One Agent')}
              </SelectItem>
              <SelectItem value="parallel">
                {translate('workflows.visual.parallel', 'Work in parallel')}
              </SelectItem>
              <SelectItem value="sequential">
                {translate('workflows.visual.sequential', 'Work in sequence')}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <RoleNumberField
          label={translate('workflows.visual.minAgents', 'Minimum')}
          value={slot.minAgents}
          disabled={readOnly}
          onChange={(minAgents) => updateSlot((current) => ({ ...current, minAgents }))}
        />
        <RoleNumberField
          label={translate('workflows.visual.maxAgents', 'Maximum')}
          value={slot.maxAgents}
          disabled={readOnly || slot.execution === 'single'}
          onChange={(maxAgents) => updateSlot((current) => ({ ...current, maxAgents }))}
        />
      </div>
      <Label className="text-xs font-normal">
        <Checkbox
          checked={slot.required}
          disabled={readOnly}
          onCheckedChange={(checked) =>
            updateSlot((current) => ({
              ...current,
              required: checked === true,
              minAgents: checked === true ? Math.max(1, current.minAgents) : 0
            }))
          }
        />
        {translate('workflows.visual.required', 'This role is required')}
      </Label>
    </div>
  )
}

function RoleNumberField({
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
      <span className="text-[11px] font-medium">{label}</span>
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
