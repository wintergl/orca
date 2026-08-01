import { Plus, Trash2 } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowTransitionV1
} from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  addWorkflowTransition,
  removeWorkflowTransition,
  updateWorkflowTransition
} from './workflow-definition-editing'

const TERMINAL_TARGETS = ['run:completed', 'run:cancelled', 'run:review-limit-reached'] as const

export function WorkflowTransitionFields({
  definition,
  node,
  transitions,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  transitions: readonly WorkflowTransitionV1[]
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV1) => void
}): React.JSX.Element | null {
  if (node.type === 'complete') {
    return null
  }
  const conditions = transitionConditions(node.type)
  return (
    <fieldset className="space-y-3 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <legend className="text-xs font-medium">
            {translate('workflows.visual.resultsAndNextSteps', 'Results and next steps')}
          </legend>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {translate(
              'workflows.visual.resultsAndNextStepsHint',
              'Choose what happens after each possible result.'
            )}
          </p>
        </div>
        {!readOnly ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => onChange(addWorkflowTransition(definition, node))}
          >
            <Plus />
            {translate('workflows.visual.addResult', 'Add result')}
          </Button>
        ) : null}
      </div>
      {transitions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          {translate(
            'workflows.visual.noResultRoute',
            'No next step is set. Add a result before saving.'
          )}
        </p>
      ) : null}
      {transitions.map((transition) => (
        <div
          key={transition.id}
          className="grid gap-2 rounded-md border border-border bg-muted/10 p-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto]"
        >
          <label className="space-y-1">
            <span className="text-[11px] font-medium">
              {translate('workflows.visual.whenResultIs', 'When the result is')}
            </span>
            <Select
              value={transition.when}
              disabled={readOnly}
              onValueChange={(when) =>
                onChange(
                  updateWorkflowTransition(definition, transition.id, (current) => ({
                    ...current,
                    when: when as WorkflowTransitionV1['when']
                  }))
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {conditions.map((condition) => (
                  <SelectItem key={condition} value={condition}>
                    {conditionLabel(condition)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium">
              {translate('workflows.visual.thenGoTo', 'Then go to')}
            </span>
            <Select
              value={transition.to}
              disabled={readOnly}
              onValueChange={(to) =>
                onChange(
                  updateWorkflowTransition(definition, transition.id, (current) => ({
                    ...current,
                    to
                  }))
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {definition.nodes
                  .filter((candidate) => candidate.id !== node.id)
                  .map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                {TERMINAL_TARGETS.map((target) => (
                  <SelectItem key={target} value={target}>
                    {terminalTargetLabel(target)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {!readOnly ? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="self-end text-muted-foreground hover:text-destructive"
              aria-label={translate('workflows.visual.deleteTransition', 'Delete result')}
              onClick={() => onChange(removeWorkflowTransition(definition, transition.id))}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
    </fieldset>
  )
}

function transitionConditions(
  type: WorkflowNodeDefinitionV1['type']
): WorkflowTransitionV1['when'][] {
  if (type === 'decide') {
    return [
      'decision:approve',
      'decision:revise',
      'decision:request-human',
      'decision:stop-at-review'
    ]
  }
  if (type === 'human-gate') {
    return ['human:approve', 'human:revise', 'human:end']
  }
  return ['step:succeeded']
}

function conditionLabel(condition: WorkflowTransitionV1['when']): string {
  switch (condition) {
    case 'step:succeeded':
      return translate('workflows.visual.resultCompleted', 'Completed')
    case 'decision:approve':
      return translate('workflows.visual.resultCompleted', 'Complete')
    case 'decision:revise':
      return translate('workflows.visual.resultNotCompleted', 'Not complete')
    case 'decision:request-human':
      return translate('workflows.visual.resultInvalid', 'Invalid result')
    case 'decision:stop-at-review':
      return translate('workflows.visual.resultStopAtReview', 'Stop at review')
    case 'human:approve':
      return translate('workflows.visual.resultHumanApproved', 'Person approved')
    case 'human:revise':
      return translate('workflows.visual.resultHumanRevised', 'Person requested changes')
    case 'human:end':
      return translate('workflows.visual.resultHumanEnded', 'Person ended the workflow')
  }
}

function terminalTargetLabel(target: (typeof TERMINAL_TARGETS)[number]): string {
  switch (target) {
    case 'run:completed':
      return translate('workflows.visual.finishWorkflow', 'Finish the workflow')
    case 'run:cancelled':
      return translate('workflows.visual.endWorkflow', 'End the workflow')
    case 'run:review-limit-reached':
      return translate('workflows.visual.stopAtReview', 'Stop at final review')
  }
}
