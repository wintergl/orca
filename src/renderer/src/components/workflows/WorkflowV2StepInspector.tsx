import { Plus, Trash2 } from 'lucide-react'
import type {
  WorkflowDefinitionV2,
  WorkflowHumanRouteV2,
  WorkflowStepDefinitionV2
} from '../../../../shared/workflow-definition-v2-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { setWorkflowV2EntryStep, updateWorkflowV2Step } from './workflow-definition-editing-v2'
import { WorkflowV2PromptFields, WorkflowV2RetryFields } from './WorkflowV2PromptFields'
import { SelectField, WorkflowV2RouteFields } from './WorkflowV2RouteFields'

export function WorkflowV2StepInspector({
  definition,
  selected,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV2
  selected: WorkflowStepDefinitionV2
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV2) => void
}): React.JSX.Element {
  const stepIds = definition.steps.map((step) => step.id)
  const recoveryStepIds = definition.steps
    .filter((step) => step.kind === 'human' || step.kind === 'end')
    .map((step) => step.id)
  const update = (updater: (step: WorkflowStepDefinitionV2) => WorkflowStepDefinitionV2): void =>
    onChange(updateWorkflowV2Step(definition, selected.id, updater))
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{selected.name}</h3>
        <span className="text-[11px] text-muted-foreground">{selected.id}</span>
      </div>
      <TextField
        label={translate('workflows.visual.stepName', 'Step name')}
        value={selected.name}
        disabled={readOnly}
        onChange={(name) => update((step) => ({ ...step, name }))}
      />
      {(selected.kind === 'agent' || selected.kind === 'decision') && !readOnly ? (
        <Button
          size="xs"
          variant="outline"
          disabled={definition.entryStepId === selected.id}
          onClick={() => onChange(setWorkflowV2EntryStep(definition, selected.id))}
        >
          {translate('workflows.visual.setEntry', 'Set as entry')}
        </Button>
      ) : null}
      {selected.kind === 'agent' ? (
        <AgentFields
          definition={definition}
          step={selected}
          stepIds={stepIds}
          recoveryStepIds={recoveryStepIds}
          readOnly={readOnly}
          update={update}
        />
      ) : null}
      {selected.kind === 'decision' ? (
        <DecisionFields
          definition={definition}
          step={selected}
          stepIds={stepIds}
          recoveryStepIds={recoveryStepIds}
          readOnly={readOnly}
          update={update}
        />
      ) : null}
      {selected.kind === 'human' ? (
        <HumanFields
          step={selected}
          stepIds={stepIds}
          recoveryStepIds={recoveryStepIds}
          readOnly={readOnly}
          update={update}
        />
      ) : null}
      {selected.kind === 'end' ? (
        <SelectField
          label={translate('workflows.visual.endOutcome', 'Outcome')}
          value={selected.outcome}
          options={['succeeded', 'cancelled', 'failed']}
          disabled={readOnly}
          onChange={(outcome) =>
            update((step) =>
              step.kind === 'end' ? { ...step, outcome: outcome as typeof step.outcome } : step
            )
          }
        />
      ) : null}
    </div>
  )
}

function AgentFields({
  definition,
  step,
  stepIds,
  recoveryStepIds,
  readOnly,
  update
}: CommonFields & {
  step: Extract<WorkflowStepDefinitionV2, { kind: 'agent' }>
}): React.JSX.Element {
  return (
    <>
      <RoleAndExecution definition={definition} step={step} readOnly={readOnly} update={update} />
      <WorkflowV2PromptFields
        prompt={step.prompt}
        definition={definition}
        stepId={step.id}
        readOnly={readOnly}
        onChange={(prompt) =>
          update((current) => (current.kind === 'agent' ? { ...current, prompt } : current))
        }
      />
      <WorkflowV2RetryFields
        retry={step.retryPolicy}
        readOnly={readOnly}
        onChange={(retryPolicy) =>
          update((current) => (current.kind === 'agent' ? { ...current, retryPolicy } : current))
        }
      />
      <WorkflowV2RouteFields
        label={translate('workflows.visual.nextStep', 'Next step')}
        route={step.next}
        stepIds={stepIds}
        recoveryStepIds={recoveryStepIds}
        readOnly={readOnly}
        onChange={(next) =>
          update((current) => (current.kind === 'agent' ? { ...current, next } : current))
        }
      />
    </>
  )
}

function DecisionFields({
  definition,
  step,
  stepIds,
  recoveryStepIds,
  readOnly,
  update
}: CommonFields & {
  step: Extract<WorkflowStepDefinitionV2, { kind: 'decision' }>
}): React.JSX.Element {
  const routes = [
    ['whenTrue', translate('workflows.visual.whenTrue', 'When 完成')],
    ['whenFalse', translate('workflows.visual.whenFalse', 'When 不完成')],
    ['whenInvalid', translate('workflows.visual.whenInvalid', 'When invalid')]
  ] as const
  return (
    <>
      <RoleAndExecution definition={definition} step={step} readOnly={readOnly} update={update} />
      <WorkflowV2PromptFields
        prompt={step.prompt}
        definition={definition}
        stepId={step.id}
        readOnly={readOnly}
        onChange={(prompt) =>
          update((current) => (current.kind === 'decision' ? { ...current, prompt } : current))
        }
      />
      <WorkflowV2RetryFields
        retry={step.retryPolicy}
        readOnly={readOnly}
        onChange={(retryPolicy) =>
          update((current) => (current.kind === 'decision' ? { ...current, retryPolicy } : current))
        }
      />
      {routes.map(([key, label]) => (
        <WorkflowV2RouteFields
          key={key}
          label={label}
          route={step.routes[key]}
          stepIds={stepIds}
          recoveryStepIds={recoveryStepIds}
          readOnly={readOnly}
          onChange={(route) =>
            update((current) =>
              current.kind === 'decision'
                ? { ...current, routes: { ...current.routes, [key]: route } }
                : current
            )
          }
        />
      ))}
    </>
  )
}

function HumanFields({
  step,
  stepIds,
  recoveryStepIds,
  readOnly,
  update
}: Omit<CommonFields, 'definition'> & {
  step: Extract<WorkflowStepDefinitionV2, { kind: 'human' }>
}): React.JSX.Element {
  const updateRoute = (routeId: string, route: WorkflowHumanRouteV2): void =>
    update((current) =>
      current.kind === 'human'
        ? { ...current, routes: current.routes.map((item) => (item.id === routeId ? route : item)) }
        : current
    )
  return (
    <section className="space-y-3">
      {step.routes.map((route) => (
        <div key={route.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-end gap-2">
            <TextField
              label={translate('workflows.visual.routeLabel', 'Label')}
              value={route.label}
              disabled={readOnly}
              onChange={(label) => updateRoute(route.id, { ...route, label })}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={readOnly || step.routes.length <= 1}
              onClick={() =>
                update((current) =>
                  current.kind === 'human'
                    ? { ...current, routes: current.routes.filter((item) => item.id !== route.id) }
                    : current
                )
              }
            >
              <Trash2 />
            </Button>
          </div>
          <WorkflowV2RouteFields
            label={translate('workflows.visual.routeTarget', 'Target')}
            route={route}
            stepIds={stepIds}
            recoveryStepIds={recoveryStepIds}
            readOnly={readOnly}
            onChange={(next) => updateRoute(route.id, { ...route, ...next })}
          />
          <div className="flex gap-4 text-xs">
            <Check
              label={translate('workflows.visual.requiresText', 'Requires text')}
              checked={route.requiresText}
              disabled={readOnly}
              onChange={(requiresText) => updateRoute(route.id, { ...route, requiresText })}
            />
            <Check
              label={translate('workflows.visual.requiresConfirmation', 'Requires confirmation')}
              checked={route.requiresConfirmation}
              disabled={readOnly}
              onChange={(requiresConfirmation) =>
                updateRoute(route.id, { ...route, requiresConfirmation })
              }
            />
          </div>
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        disabled={readOnly}
        onClick={() =>
          update((current) =>
            current.kind === 'human'
              ? { ...current, routes: [...current.routes, newHumanRoute(current.routes)] }
              : current
          )
        }
      >
        <Plus />
        {translate('workflows.visual.addRoute', 'Add route')}
      </Button>
    </section>
  )
}

function RoleAndExecution({
  definition,
  step,
  readOnly,
  update
}: Pick<CommonFields, 'definition' | 'readOnly' | 'update'> & {
  step: Extract<WorkflowStepDefinitionV2, { kind: 'agent' | 'decision' }>
}): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={translate('workflows.visual.role', 'Role')}
        value={step.roleSlotIds[0] ?? ''}
        options={definition.roleSlots.map((slot) => slot.id)}
        optionLabels={Object.fromEntries(definition.roleSlots.map((slot) => [slot.id, slot.label]))}
        disabled={readOnly}
        onChange={(role) =>
          update((current) =>
            current.kind === 'agent'
              ? { ...current, roleSlotIds: [role] }
              : current.kind === 'decision'
                ? { ...current, roleSlotIds: [role] }
                : current
          )
        }
      />
      {step.kind === 'agent' ? (
        <SelectField
          label={translate('workflows.visual.execution', 'Execution')}
          value={step.execution}
          options={['single', 'parallel', 'sequential']}
          disabled={readOnly}
          onChange={(execution) =>
            update((current) =>
              current.kind === 'agent'
                ? { ...current, execution: execution as typeof current.execution }
                : current
            )
          }
        />
      ) : null}
    </div>
  )
}

type CommonFields = {
  definition: WorkflowDefinitionV2
  stepIds: string[]
  recoveryStepIds: string[]
  readOnly: boolean
  update: (updater: (step: WorkflowStepDefinitionV2) => WorkflowStepDefinitionV2) => void
}

function TextField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="min-w-0 flex-1 space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-8 text-xs"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function Check({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  )
}

function newHumanRoute(routes: WorkflowHumanRouteV2[]): WorkflowHumanRouteV2 {
  let index = routes.length + 1
  while (routes.some((route) => route.id === `route-${index}`)) {
    index += 1
  }
  return {
    id: `route-${index}`,
    label: translate('workflows.visual.routeNumber', 'Route {{count}}', { count: index }),
    targetStepId: routes[0]?.targetStepId ?? 'end',
    requiresText: false,
    requiresConfirmation: true
  }
}
