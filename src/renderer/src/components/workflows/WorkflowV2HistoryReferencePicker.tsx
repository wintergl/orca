import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import { workflowPromptHistoryToken } from '../../../../shared/workflow-prompt-instructions'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

type HistoryCycle = '-1' | '-2' | '1' | 'currentRound'

export function WorkflowV2HistoryReferencePicker({
  definition,
  stepId,
  readOnly,
  onInsert
}: {
  definition: WorkflowDefinitionV2
  stepId: string
  readOnly: boolean
  onInsert: (token: string) => void
}): React.JSX.Element {
  const candidates = useMemo(
    () => definition.steps.filter((step) => step.kind === 'agent' || step.kind === 'decision'),
    [definition.steps]
  )
  const upstreamId = suggestedUpstreamStepId(definition, stepId)
  const [cycle, setCycle] = useState<HistoryCycle>('-1')
  const [sourceStepId, setSourceStepId] = useState(upstreamId)
  const token = workflowPromptHistoryToken(
    cycle === 'currentRound' ? 'currentRound' : Number(cycle),
    sourceStepId
  )
  return (
    <section className="space-y-3 rounded-md border border-border bg-muted/15 p-3">
      <div>
        <h4 className="text-xs font-semibold">
          {translate('workflows.prompt.insertHistory', 'Insert history output')}
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {translate(
            'workflows.prompt.historyHint',
            'Cycle and stable step ID uniquely locate an append-only output.'
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={readOnly}
          onClick={() => onInsert(workflowPromptHistoryToken(-1, stepId))}
        >
          {translate('workflows.prompt.previousSameNode', 'Previous result from this step')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={readOnly}
          onClick={() => onInsert(workflowPromptHistoryToken(-1, upstreamId))}
        >
          {translate('workflows.prompt.previousUpstreamNode', 'Previous upstream result')}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <HistorySelect
          label={translate('workflows.prompt.historyRound', 'Cycle')}
          value={cycle}
          disabled={readOnly}
          onChange={(value) => setCycle(value as HistoryCycle)}
        >
          <SelectItem value="-1">
            {translate('workflows.prompt.previousCycle', 'Previous (-1)')}
          </SelectItem>
          <SelectItem value="-2">
            {translate('workflows.prompt.twoCyclesBack', 'Two cycles back (-2)')}
          </SelectItem>
          <SelectItem value="1">{translate('workflows.prompt.cycleOne', 'Cycle 1')}</SelectItem>
          <SelectItem value="currentRound">
            {translate('workflows.prompt.currentCycle', 'Current cycle')}
          </SelectItem>
        </HistorySelect>
        <HistorySelect
          label={translate('workflows.prompt.historyNode', 'Step')}
          value={sourceStepId}
          disabled={readOnly}
          onChange={setSourceStepId}
        >
          {candidates.map((step) => (
            <SelectItem key={step.id} value={step.id}>
              {step.name} ({step.id})
            </SelectItem>
          ))}
        </HistorySelect>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
          {token}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={readOnly}
          onClick={() => onInsert(token)}
        >
          <Plus /> {translate('workflows.prompt.insert', 'Insert')}
        </Button>
      </div>
    </section>
  )
}

function HistorySelect({
  label,
  value,
  disabled,
  children,
  onChange
}: {
  label: string
  value: string
  disabled: boolean
  children: React.ReactNode
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  )
}

function suggestedUpstreamStepId(definition: WorkflowDefinitionV2, stepId: string): string {
  const index = definition.steps.findIndex((step) => step.id === stepId)
  return (
    definition.steps
      .slice(0, Math.max(0, index))
      .toReversed()
      .find((step) => step.kind === 'agent' || step.kind === 'decision')?.id ?? stepId
  )
}
