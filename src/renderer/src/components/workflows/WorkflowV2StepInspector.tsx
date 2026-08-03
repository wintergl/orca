import type {
  WorkflowDefinitionV2,
  WorkflowStepDefinitionV2
} from '../../../../shared/workflow-definition-v2-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { setWorkflowV2EntryStep, updateWorkflowV2Step } from './workflow-definition-editing-v2'

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
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{selected.name}</h3>
        <span className="text-[11px] text-muted-foreground">{selected.id}</span>
      </div>
      <Field
        label={translate('workflows.visual.stepName', 'Step name')}
        value={selected.name}
        disabled={readOnly}
        onChange={(name) =>
          onChange(updateWorkflowV2Step(definition, selected.id, (step) => ({ ...step, name })))
        }
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
        <>
          <TextAreaField
            label={translate('workflows.prompt.template', 'Prompt template')}
            value={selected.prompt.variants[0]?.template ?? ''}
            disabled={readOnly}
            onChange={(template) =>
              onChange(
                updateWorkflowV2Step(definition, selected.id, (step) =>
                  step.kind === 'agent'
                    ? {
                        ...step,
                        prompt: { ...step.prompt, variants: [{ when: 'always', template }] }
                      }
                    : step
                )
              )
            }
          />
          <TargetSelect
            label={translate('workflows.visual.nextStep', 'Next step')}
            value={selected.next.targetStepId}
            options={stepIds}
            disabled={readOnly}
            onChange={(targetStepId) =>
              onChange(
                updateWorkflowV2Step(definition, selected.id, (step) =>
                  step.kind === 'agent' ? { ...step, next: { ...step.next, targetStepId } } : step
                )
              )
            }
          />
        </>
      ) : null}
      {selected.kind === 'decision' ? (
        <DecisionFields
          definition={definition}
          selected={selected}
          stepIds={stepIds}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : null}
      {selected.kind === 'human' ? (
        <HumanFields
          definition={definition}
          selected={selected}
          stepIds={stepIds}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : null}
      {selected.kind === 'end' ? (
        <p className="text-xs text-muted-foreground">
          {translate('workflows.visual.endOutcome', 'Outcome')}: {selected.outcome}
        </p>
      ) : null}
    </div>
  )
}

function DecisionFields({
  definition,
  selected,
  stepIds,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV2
  selected: Extract<WorkflowStepDefinitionV2, { kind: 'decision' }>
  stepIds: string[]
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV2) => void
}): React.JSX.Element {
  return (
    <>
      <TextAreaField
        label={translate('workflows.prompt.template', 'Prompt template')}
        value={selected.prompt.variants[0]?.template ?? ''}
        disabled={readOnly}
        onChange={(template) =>
          onChange(
            updateWorkflowV2Step(definition, selected.id, (step) =>
              step.kind === 'decision'
                ? {
                    ...step,
                    prompt: { ...step.prompt, variants: [{ when: 'always', template }] }
                  }
                : step
            )
          )
        }
      />
      <TargetSelect
        label={translate('workflows.visual.whenTrue', 'When 完成')}
        value={selected.routes.whenTrue.targetStepId}
        options={stepIds}
        disabled={readOnly}
        onChange={(targetStepId) =>
          onChange(
            updateWorkflowV2Step(definition, selected.id, (step) =>
              step.kind === 'decision'
                ? {
                    ...step,
                    routes: {
                      ...step.routes,
                      whenTrue: { ...step.routes.whenTrue, targetStepId }
                    }
                  }
                : step
            )
          )
        }
      />
      <TargetSelect
        label={translate('workflows.visual.whenFalse', 'When 不完成')}
        value={selected.routes.whenFalse.targetStepId}
        options={stepIds}
        disabled={readOnly}
        onChange={(targetStepId) =>
          onChange(
            updateWorkflowV2Step(definition, selected.id, (step) =>
              step.kind === 'decision'
                ? {
                    ...step,
                    routes: {
                      ...step.routes,
                      whenFalse: { ...step.routes.whenFalse, targetStepId }
                    }
                  }
                : step
            )
          )
        }
      />
      <Field
        label={translate('workflows.visual.maxTraversals', 'False-route max traversals')}
        value={String(selected.routes.whenFalse.maxTraversals ?? '')}
        disabled={readOnly}
        onChange={(raw) => {
          const maxTraversals = raw.trim() === '' ? undefined : Number(raw)
          onChange(
            updateWorkflowV2Step(definition, selected.id, (step) =>
              step.kind === 'decision'
                ? {
                    ...step,
                    routes: {
                      ...step.routes,
                      whenFalse: {
                        ...step.routes.whenFalse,
                        ...(typeof maxTraversals === 'number' && Number.isInteger(maxTraversals)
                          ? { maxTraversals }
                          : { maxTraversals: undefined })
                      }
                    }
                  }
                : step
            )
          )
        }}
      />
    </>
  )
}

function HumanFields({
  definition,
  selected,
  stepIds,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV2
  selected: Extract<WorkflowStepDefinitionV2, { kind: 'human' }>
  stepIds: string[]
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV2) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <p className="text-xs font-medium">
        {translate('workflows.visual.humanRoutes', 'Human routes')}
      </p>
      {selected.routes.map((route) => (
        <div key={route.id} className="grid gap-2 sm:grid-cols-2">
          <Field
            label={translate('workflows.visual.routeLabel', 'Label')}
            value={route.label}
            disabled={readOnly}
            onChange={(label) =>
              onChange(
                updateWorkflowV2Step(definition, selected.id, (step) =>
                  step.kind === 'human'
                    ? {
                        ...step,
                        routes: step.routes.map((candidate) =>
                          candidate.id === route.id ? { ...candidate, label } : candidate
                        )
                      }
                    : step
                )
              )
            }
          />
          <TargetSelect
            label={translate('workflows.visual.routeTarget', 'Target')}
            value={route.targetStepId}
            options={stepIds}
            disabled={readOnly}
            onChange={(targetStepId) =>
              onChange(
                updateWorkflowV2Step(definition, selected.id, (step) =>
                  step.kind === 'human'
                    ? {
                        ...step,
                        routes: step.routes.map((candidate) =>
                          candidate.id === route.id ? { ...candidate, targetStepId } : candidate
                        )
                      }
                    : step
                )
              )
            }
          />
        </div>
      ))}
    </div>
  )
}

function Field({
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
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-8 text-xs"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function TextAreaField({
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
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        className="min-h-28 font-mono text-xs"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function TargetSelect({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  value: string
  options: string[]
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
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
