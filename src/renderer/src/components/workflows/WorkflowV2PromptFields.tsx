import { useState } from 'react'
import type {
  WorkflowDefinitionV2,
  WorkflowPromptV2,
  WorkflowRetryPolicyV2
} from '../../../../shared/workflow-definition-v2-types'
import { inspectWorkflowPromptInstructions } from '../../../../shared/workflow-prompt-instructions'
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
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { WorkflowV2HistoryReferencePicker } from './WorkflowV2HistoryReferencePicker'

export function WorkflowV2PromptFields({
  prompt,
  definition,
  stepId,
  readOnly,
  onChange
}: {
  prompt: WorkflowPromptV2
  definition: WorkflowDefinitionV2
  stepId: string
  readOnly: boolean
  onChange: (prompt: WorkflowPromptV2) => void
}): React.JSX.Element {
  const first = prompt.variants.find((variant) => variant.when === 'first-visit')
  const repeat = prompt.variants.find((variant) => variant.when === 'repeat-visit')
  const always = prompt.variants.find((variant) => variant.when === 'always')
  const firstValue = first?.template ?? always?.template ?? ''
  const repeatValue = repeat?.template ?? always?.template ?? ''
  const [historyTarget, setHistoryTarget] = useState<'first-visit' | 'repeat-visit'>('repeat-visit')
  const setVariant = (when: 'first-visit' | 'repeat-visit', template: string): void => {
    const variants = prompt.variants.filter(
      (variant) => variant.when !== when && variant.when !== 'always'
    )
    variants.push({ when, template })
    onChange({ ...prompt, variants })
  }
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <TextField
          label={translate('workflows.prompt.firstVisit', 'First visit')}
          value={firstValue}
          error={promptBoundaryError('first-visit', firstValue, prompt.repeatVisitHistoryMode)}
          disabled={readOnly}
          onChange={(template) => setVariant('first-visit', template)}
          onFocus={() => setHistoryTarget('first-visit')}
        />
        <TextField
          label={translate('workflows.prompt.repeatVisit', 'Repeat visit')}
          value={repeatValue}
          error={promptBoundaryError('repeat-visit', repeatValue, prompt.repeatVisitHistoryMode)}
          disabled={readOnly}
          onChange={(template) => setVariant('repeat-visit', template)}
          onFocus={() => setHistoryTarget('repeat-visit')}
        />
      </div>
      <WorkflowV2HistoryReferencePicker
        definition={definition}
        stepId={stepId}
        readOnly={readOnly}
        onInsert={(token) => {
          const current =
            historyTarget === 'first-visit'
              ? (first?.template ?? always?.template ?? '')
              : (repeat?.template ?? always?.template ?? '')
          setVariant(historyTarget, `${current}${current.endsWith('\n') ? '' : '\n'}${token}`)
        }}
      />
      <label className="flex items-start gap-2 text-xs">
        <Checkbox
          checked={prompt.repeatVisitHistoryMode === 'not-required'}
          disabled={readOnly}
          onCheckedChange={(checked) =>
            onChange({
              ...prompt,
              repeatVisitHistoryMode: checked === true ? 'not-required' : 'required'
            })
          }
        />
        <span>
          {translate(
            'workflows.prompt.noRepeatHistory',
            'Repeat visits intentionally do not read prior history.'
          )}
        </span>
      </label>
      <TextField
        label={translate('workflows.prompt.completionCriteria', 'Completion criteria')}
        value={prompt.completionCriteria}
        disabled={readOnly}
        compact
        onChange={(completionCriteria) => onChange({ ...prompt, completionCriteria })}
      />
    </section>
  )
}

export function WorkflowV2RetryFields({
  retry,
  readOnly,
  onChange
}: {
  retry: WorkflowRetryPolicyV2
  readOnly: boolean
  onChange: (retry: WorkflowRetryPolicyV2) => void
}): React.JSX.Element {
  return (
    <section className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
      <NumberField
        label={translate('workflows.visual.maxAttempts', 'Max attempts')}
        value={retry.maxAttempts}
        min={0}
        max={20}
        disabled={readOnly}
        onChange={(maxAttempts) => onChange({ ...retry, maxAttempts })}
      />
      <NumberField
        label={translate('workflows.visual.backoffMs', 'Backoff (ms)')}
        value={retry.backoffMs}
        min={0}
        max={3_600_000}
        disabled={readOnly}
        onChange={(backoffMs) => onChange({ ...retry, backoffMs })}
      />
      <div className="space-y-1">
        <Label className="text-xs">
          {translate('workflows.visual.onExhausted', 'When exhausted')}
        </Label>
        <Select
          value={retry.onExhausted}
          disabled={readOnly}
          onValueChange={(onExhausted) =>
            onChange({ ...retry, onExhausted: onExhausted as WorkflowRetryPolicyV2['onExhausted'] })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="human">
              {translate('workflows.visual.waitHuman', 'Wait for human')}
            </SelectItem>
            <SelectItem value="fail-run">
              {translate('workflows.visual.failRun', 'Fail Run')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}

function TextField({
  label,
  value,
  disabled,
  compact = false,
  onChange,
  onFocus,
  error
}: {
  label: string
  value: string
  disabled: boolean
  compact?: boolean
  onChange: (value: string) => void
  onFocus?: () => void
  error?: string | null
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        className={compact ? 'min-h-20 text-xs' : 'min-h-40 font-mono text-xs'}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </label>
  )
}

function promptBoundaryError(
  when: 'first-visit' | 'repeat-visit',
  value: string,
  repeatMode: WorkflowPromptV2['repeatVisitHistoryMode']
): string | null {
  if (!value.trim()) {
    return translate('workflows.prompt.required', 'This prompt boundary is required.')
  }
  const inspection = inspectWorkflowPromptInstructions(value)
  if (inspection.malformed || inspection.unknown.length > 0) {
    return translate(
      'workflows.prompt.invalidPlaceholders',
      'This prompt has invalid placeholders.'
    )
  }
  if (!inspection.placeholders.includes('criteria')) {
    return translate(
      'workflows.prompt.criteriaRequired',
      'Include the completion criteria variable.'
    )
  }
  if (
    when === 'first-visit' &&
    inspection.historyReferences.some(
      (reference) => typeof reference.round === 'number' && reference.round < 0
    )
  ) {
    return translate(
      'workflows.prompt.firstNegativeHistory',
      'First visit cannot reference a negative history cycle.'
    )
  }
  if (
    when === 'repeat-visit' &&
    inspection.historyReferences.length === 0 &&
    repeatMode !== 'not-required'
  ) {
    return translate(
      'workflows.prompt.repeatNeedsHistory',
      'Add a history reference or explicitly declare that history is not required.'
    )
  }
  return null
}

function NumberField({
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
    <label className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        className="h-8 text-xs"
        onChange={(event) =>
          onChange(Math.min(max, Math.max(min, Math.round(Number(event.target.value) || 0))))
        }
      />
    </label>
  )
}
