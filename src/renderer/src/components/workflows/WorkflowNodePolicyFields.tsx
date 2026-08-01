import {
  WORKFLOW_RESOLUTION_ACTIONS,
  WORKFLOW_WAITING_REASONS,
  type WorkflowNodeDefinitionV1
} from '../../../../shared/workflow-definition-types'
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
import { resolutionActionLabel, waitingReasonLabel } from './workflow-policy-copy'

type UpdateNode = (update: (node: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1) => void

export function WorkflowNodePolicyFields({
  node,
  readOnly,
  updateNode
}: {
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  updateNode: UpdateNode
}): React.JSX.Element | null {
  if (node.type === 'produce') {
    return (
      <LabeledSelect
        label={translate('workflows.visual.stepOutput', 'This step creates')}
        value={node.artifactKind}
        disabled={readOnly}
        onChange={(artifactKind) =>
          updateNode((current) =>
            current.type === 'produce'
              ? { ...current, artifactKind: artifactKind as typeof current.artifactKind }
              : current
          )
        }
        options={[
          ['spec', translate('workflows.visual.specDocument', 'A SPEC document')],
          ['code', translate('workflows.visual.codeChanges', 'Code changes')]
        ]}
      />
    )
  }
  if (node.type === 'review') {
    return <ReviewPolicyFields node={node} readOnly={readOnly} updateNode={updateNode} />
  }
  if (node.type === 'decide') {
    return (
      <LabeledSelect
        label={translate('workflows.visual.decisionMethod', 'How to decide')}
        value={node.mode}
        disabled={readOnly}
        onChange={(mode) =>
          updateNode((current) =>
            current.type === 'decide' ? { ...current, mode: mode as typeof current.mode } : current
          )
        }
        options={[
          ['rules', translate('workflows.visual.rulesOnly', 'Use rules automatically')],
          [
            'rules-then-agent',
            translate(
              'workflows.visual.rulesThenAgentFriendly',
              'Ask an Agent when rules are unclear'
            )
          ]
        ]}
      />
    )
  }
  if (node.type === 'human-gate') {
    return (
      <p className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {translate(
          'workflows.visual.humanGateDescription',
          'The workflow pauses here until a person approves, requests changes, or ends it.'
        )}
      </p>
    )
  }
  return null
}

export function WorkflowNodeAdvancedPolicyFields({
  node,
  readOnly,
  updateNode
}: {
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  updateNode: UpdateNode
}): React.JSX.Element | null {
  if (node.type === 'review') {
    return <ReviewAdvancedFields node={node} readOnly={readOnly} updateNode={updateNode} />
  }
  if (node.type === 'human-gate') {
    return <HumanGateAdvancedFields node={node} readOnly={readOnly} updateNode={updateNode} />
  }
  return null
}

function ReviewPolicyFields({
  node,
  readOnly,
  updateNode
}: {
  node: Extract<WorkflowNodeDefinitionV1, { type: 'review' }>
  readOnly: boolean
  updateNode: UpdateNode
}): React.JSX.Element {
  const updatePolicy = (
    update: Partial<Extract<WorkflowNodeDefinitionV1, { type: 'review' }>['reviewPolicy']>
  ): void => {
    updateNode((current) =>
      current.type === 'review'
        ? { ...current, reviewPolicy: { ...current.reviewPolicy, ...update } }
        : current
    )
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">
        {translate('workflows.visual.passRules', 'Review rules')}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <PolicyNumberInput
          label={translate('workflows.visual.reviewersNeeded', 'Reviewers needed')}
          value={node.reviewPolicy.minReviewers}
          min={1}
          max={8}
          disabled={readOnly}
          onChange={(minReviewers) => updatePolicy({ minReviewers })}
        />
        <PolicyNumberInput
          label={translate('workflows.visual.maxReviewRounds', 'Maximum rounds')}
          value={node.reviewPolicy.maxReviewRounds}
          min={1}
          max={20}
          disabled={readOnly}
          onChange={(maxReviewRounds) => updatePolicy({ maxReviewRounds })}
        />
      </div>
    </fieldset>
  )
}

function ReviewAdvancedFields({
  node,
  readOnly,
  updateNode
}: {
  node: Extract<WorkflowNodeDefinitionV1, { type: 'review' }>
  readOnly: boolean
  updateNode: UpdateNode
}): React.JSX.Element {
  const updatePolicy = (
    update: Partial<Extract<WorkflowNodeDefinitionV1, { type: 'review' }>['reviewPolicy']>
  ): void => {
    updateNode((current) =>
      current.type === 'review'
        ? { ...current, reviewPolicy: { ...current.reviewPolicy, ...update } }
        : current
    )
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">
        {translate('workflows.visual.reviewFailureHandling', 'Review timing and failure')}
      </legend>
      <PolicyNumberInput
        label={translate('workflows.visual.maxReviewMinutes', 'Maximum review time (minutes)')}
        value={node.reviewPolicy.timeoutMs ? Math.round(node.reviewPolicy.timeoutMs / 60_000) : 0}
        min={0}
        max={1440}
        disabled={readOnly}
        onChange={(minutes) => updatePolicy({ timeoutMs: minutes === 0 ? null : minutes * 60_000 })}
      />
      <LabeledSelect
        label={translate('workflows.visual.reviewerFailure', 'If a reviewer fails')}
        value={node.reviewPolicy.onReviewerFailure}
        disabled={readOnly}
        onChange={(onReviewerFailure) =>
          updatePolicy({
            onReviewerFailure: onReviewerFailure as typeof node.reviewPolicy.onReviewerFailure
          })
        }
        options={[
          ['fail-run', translate('workflows.visual.endWorkflow', 'End the workflow')],
          ['wait-human', translate('workflows.visual.askForHelp', 'Wait for human help')]
        ]}
      />
    </fieldset>
  )
}

function HumanGateAdvancedFields({
  node,
  readOnly,
  updateNode
}: {
  node: Extract<WorkflowNodeDefinitionV1, { type: 'human-gate' }>
  readOnly: boolean
  updateNode: UpdateNode
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <OptionChecklist
        title={translate('workflows.visual.pauseReasons', 'Reasons this step may pause')}
        options={WORKFLOW_WAITING_REASONS}
        selected={node.waitingReasons}
        label={waitingReasonLabel}
        readOnly={readOnly}
        onToggle={(value, checked) =>
          updateNode((current) =>
            current.type === 'human-gate'
              ? {
                  ...current,
                  waitingReasons: checked
                    ? [...current.waitingReasons, value]
                    : current.waitingReasons.filter((item) => item !== value)
                }
              : current
          )
        }
      />
      <OptionChecklist
        title={translate('workflows.visual.availableActions', 'Actions people can take')}
        options={WORKFLOW_RESOLUTION_ACTIONS}
        selected={node.allowedActions}
        label={resolutionActionLabel}
        readOnly={readOnly}
        onToggle={(value, checked) =>
          updateNode((current) =>
            current.type === 'human-gate'
              ? {
                  ...current,
                  allowedActions: checked
                    ? [...current.allowedActions, value]
                    : current.allowedActions.filter((item) => item !== value)
                }
              : current
          )
        }
      />
    </div>
  )
}

function OptionChecklist<T extends string>({
  title,
  options,
  selected,
  label,
  readOnly,
  onToggle
}: {
  title: string
  options: readonly T[]
  selected: readonly T[]
  label: (value: T) => string
  readOnly: boolean
  onToggle: (value: T, checked: boolean) => void
}): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">{title}</legend>
      <div className="scrollbar-sleek grid max-h-48 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
        {options.map((option) => (
          <Label key={option} className="text-xs font-normal">
            <Checkbox
              checked={selected.includes(option)}
              disabled={readOnly}
              onCheckedChange={(checked) => onToggle(option, checked === true)}
            />
            <span>{label(option)}</span>
          </Label>
        ))}
      </div>
    </fieldset>
  )
}

function LabeledSelect({
  label,
  value,
  disabled,
  onChange,
  options
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  options: readonly (readonly [string, string])[]
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, optionLabel]) => (
            <SelectItem key={option} value={option}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function PolicyNumberInput({
  label,
  value,
  min,
  max,
  disabled,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
