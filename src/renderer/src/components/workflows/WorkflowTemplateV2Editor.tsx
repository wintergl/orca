import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import type { WorkflowStepKindV2 } from '../../../../shared/workflow-definition-v2-types'
import { parseWorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { addWorkflowV2Step, removeWorkflowV2Step } from './workflow-definition-editing-v2'
import { WorkflowV2StepInspector } from './WorkflowV2StepInspector'

const STEP_KINDS: WorkflowStepKindV2[] = ['agent', 'decision', 'human', 'end']

export function WorkflowTemplateV2Editor({
  definition,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV2
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV2) => void
}): React.JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState(definition.entryStepId)
  const [newKind, setNewKind] = useState<WorkflowStepKindV2>('agent')
  const selected =
    definition.steps.find((step) => step.id === selectedStepId) ??
    definition.steps.find((step) => step.id === definition.entryStepId) ??
    definition.steps[0] ??
    null
  const validation = useMemo(() => {
    try {
      parseWorkflowDefinitionV2(definition)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid V2 definition'
    }
  }, [definition])

  return (
    <section
      data-workflow-template-editor="v2"
      className="grid h-full min-h-0 w-full min-w-0 overflow-hidden bg-card xl:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]"
    >
      <aside className="flex min-h-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-2">
          {!readOnly ? (
            <>
              <Select
                value={newKind}
                onValueChange={(value) => setNewKind(value as WorkflowStepKindV2)}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kindLabel(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const result = addWorkflowV2Step(definition, newKind)
                  onChange(result.definition)
                  setSelectedStepId(result.stepId)
                }}
              >
                <Plus />
                {translate('workflows.visual.addStep', 'Add step')}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate('workflows.templates.v2Graph', 'V2 free-form graph')}
            </p>
          )}
        </div>
        <ul className="scrollbar-sleek min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {definition.steps.map((step) => (
            <li key={step.id}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${
                    selected?.id === step.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/40'
                  }`}
                  onClick={() => setSelectedStepId(step.id)}
                >
                  <Badge variant="outline">{kindLabel(step.kind)}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{step.name}</span>
                  {definition.entryStepId === step.id ? (
                    <Badge variant="secondary">
                      {translate('workflows.visual.entry', 'Entry')}
                    </Badge>
                  ) : null}
                </button>
                {!readOnly && step.kind !== 'end' && definition.entryStepId !== step.id ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={translate('workflows.visual.removeStep', 'Remove step')}
                    onClick={() => {
                      try {
                        onChange(removeWorkflowV2Step(definition, step.id))
                        if (selectedStepId === step.id) {
                          setSelectedStepId(definition.entryStepId)
                        }
                      } catch {
                        // Keep selection when remove is invalid (entry/last end).
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {validation ? (
          <p className="border-t border-border px-2 py-1.5 text-[11px] text-destructive">
            {validation}
          </p>
        ) : (
          <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
            {translate('workflows.templates.v2Valid', 'V2 definition is valid')}
          </p>
        )}
      </aside>
      <div className="scrollbar-sleek min-h-0 overflow-auto p-3">
        {selected ? (
          <WorkflowV2StepInspector
            definition={definition}
            selected={selected}
            readOnly={readOnly}
            onChange={onChange}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate('workflows.templates.selectStep', 'Select a step')}
          </p>
        )}
      </div>
    </section>
  )
}

function kindLabel(kind: WorkflowStepKindV2): string {
  switch (kind) {
    case 'agent':
      return translate('workflows.visual.kindAgent', 'Agent')
    case 'decision':
      return translate('workflows.visual.kindDecision', 'Decision')
    case 'human':
      return translate('workflows.visual.kindHuman', 'Human')
    case 'end':
      return translate('workflows.visual.kindEnd', 'End')
  }
}
