import { useState } from 'react'
import { Copy, Plus } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1
} from '../../../../shared/workflow-definition-types'
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

type HistoryRound = '-1' | '-2' | '1' | 'currentRound'

export function WorkflowHistoryReferencePicker({
  definition,
  node,
  readOnly,
  onInsert
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  onInsert: (token: string) => void
}): React.JSX.Element {
  const [round, setRound] = useState<HistoryRound>('-1')
  const [nodeId, setNodeId] = useState(() => suggestedHistoryNodeId(definition, node))
  const candidates = definition.nodes.filter(
    (candidate) => candidate.type !== 'human-gate' && candidate.type !== 'complete'
  )
  const token = workflowPromptHistoryToken(
    round === 'currentRound' ? 'currentRound' : Number(round),
    nodeId
  )

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/15 p-3">
      <div>
        <h4 className="text-xs font-semibold">
          {translate('workflows.prompt.insertHistory', 'Insert history output')}
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {translate(
            'workflows.prompt.historyHint',
            'Round and node ID uniquely locate a completed Agent response.'
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={readOnly}
          onClick={() => onInsert(workflowPromptHistoryToken(-1, node.id))}
        >
          {translate('workflows.prompt.previousSameNode', 'Previous result from this node')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={readOnly}
          onClick={() =>
            onInsert(workflowPromptHistoryToken(-1, suggestedHistoryNodeId(definition, node)))
          }
        >
          {translate('workflows.prompt.previousUpstreamNode', 'Previous upstream result')}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <HistorySelect
          label={translate('workflows.prompt.historyRound', 'Round')}
          value={round}
          disabled={readOnly}
          onValueChange={(value) => setRound(value as HistoryRound)}
        >
          <SelectItem value="-1">
            {translate('workflows.prompt.previousRound', 'Previous (-1)')}
          </SelectItem>
          <SelectItem value="-2">
            {translate('workflows.prompt.twoRoundsBack', 'Two rounds back (-2)')}
          </SelectItem>
          <SelectItem value="1">{translate('workflows.prompt.firstRound', 'Round 1')}</SelectItem>
          <SelectItem value="currentRound">
            {translate('workflows.prompt.thisRound', 'Current round')}
          </SelectItem>
        </HistorySelect>
        <HistorySelect
          label={translate('workflows.prompt.historyNode', 'Node')}
          value={nodeId}
          disabled={readOnly}
          onValueChange={setNodeId}
        >
          {candidates.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.id})
            </SelectItem>
          ))}
        </HistorySelect>
        <HistorySelect
          label={translate('workflows.prompt.historyContent', 'Content')}
          value="output"
          disabled
          onValueChange={() => undefined}
        >
          <SelectItem value="output">
            {translate('workflows.prompt.finalOutput', 'Final output')}
          </SelectItem>
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
          <Plus />
          {translate('workflows.prompt.insert', 'Insert')}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={translate('workflows.prompt.copyVariable', 'Copy variable')}
          onClick={() => void navigator.clipboard.writeText(token)}
        >
          <Copy />
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
  onValueChange
}: {
  label: string
  value: string
  disabled: boolean
  children: React.ReactNode
  onValueChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="min-w-0 space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  )
}

function suggestedHistoryNodeId(
  definition: WorkflowDefinitionV1,
  node: WorkflowNodeDefinitionV1
): string {
  const index = definition.nodes.findIndex((candidate) => candidate.id === node.id)
  return (
    definition.nodes
      .slice(0, Math.max(0, index))
      .toReversed()
      .find((candidate) => candidate.type !== 'human-gate' && candidate.type !== 'complete')?.id ??
    node.id
  )
}
