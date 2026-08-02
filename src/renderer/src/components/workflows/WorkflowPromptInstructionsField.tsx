import type {
  WorkflowNodeDefinitionV1,
  WorkflowPromptTemplateKey
} from '../../../../shared/workflow-definition-types'
import { workflowDecisionProtocolInstruction } from '../../../../shared/workflow-decision-protocol'
import {
  defaultWorkflowPromptInstructions,
  inspectWorkflowPromptInstructions,
  requiredWorkflowPromptInputBindings,
  WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH,
  WORKFLOW_PROMPT_PLACEHOLDERS,
  type WorkflowPromptPlaceholderName
} from '../../../../shared/workflow-prompt-instructions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'

export function WorkflowPromptInstructionsField({
  node,
  readOnly,
  updateNode
}: {
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  updateNode: (update: (node: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1) => void
}): React.JSX.Element {
  const value = node.promptInstructions ?? defaultWorkflowPromptInstructions(node.promptTemplateKey)
  const inspection = inspectWorkflowPromptInstructions(value)
  const invalid =
    value.trim().length === 0 ||
    inspection.malformed ||
    inspection.unknown.length > 0 ||
    inspection.placeholders.some((name) => {
      const binding = WORKFLOW_PROMPT_PLACEHOLDERS.find(
        (placeholder) => placeholder.name === name
      )?.inputBinding
      return binding ? !node.inputBindings.includes(binding) : false
    })

  const insertPlaceholder = (placeholder: (typeof WORKFLOW_PROMPT_PLACEHOLDERS)[number]): void => {
    updateNode((current) => {
      const currentValue =
        current.promptInstructions ?? defaultWorkflowPromptInstructions(current.promptTemplateKey)
      const separator = currentValue.endsWith('\n') || currentValue.length === 0 ? '' : '\n'
      return {
        ...current,
        promptInstructions: `${currentValue}${separator}${placeholder.token}`,
        inputBindings:
          placeholder.inputBinding && !current.inputBindings.includes(placeholder.inputBinding)
            ? [...current.inputBindings, placeholder.inputBinding]
            : current.inputBindings
      }
    })
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {translate('workflows.prompt.instructions', 'Agent work instructions')}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'workflows.prompt.instructionsHint',
              'Placeholders are replaced with the current round context before dispatch.'
            )}
          </p>
        </div>
        {!readOnly ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() =>
              updateNode((current) => {
                const promptInstructions = defaultWorkflowPromptInstructions(
                  current.promptTemplateKey
                )
                return {
                  ...current,
                  promptInstructions,
                  inputBindings: [
                    ...new Set([
                      ...current.inputBindings,
                      ...requiredWorkflowPromptInputBindings(promptInstructions)
                    ])
                  ]
                }
              })
            }
          >
            {translate('workflows.prompt.restoreDefault', 'Restore default')}
          </Button>
        ) : null}
      </div>
      <Textarea
        value={value}
        readOnly={readOnly}
        maxLength={WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH}
        aria-invalid={invalid}
        aria-label={translate('workflows.prompt.instructionsAria', 'Agent work instructions')}
        className="min-h-44 font-mono text-xs leading-relaxed"
        onChange={(event) =>
          updateNode((current) => ({ ...current, promptInstructions: event.target.value }))
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {WORKFLOW_PROMPT_PLACEHOLDERS.map((placeholder) => (
          <Button
            key={placeholder.name}
            type="button"
            size="xs"
            variant="outline"
            disabled={readOnly}
            title={promptPlaceholderDescription(placeholder.name)}
            onClick={() => insertPlaceholder(placeholder)}
          >
            {placeholder.token}
          </Button>
        ))}
      </div>
      <div className="flex items-start justify-between gap-3 text-[11px] text-muted-foreground">
        <p>
          {invalid
            ? promptValidationMessage(value, inspection, node)
            : translate(
                'workflows.prompt.systemContractHint',
                'Orca still appends identity, frozen Artifact, output schema, and receipt rules.'
              )}
        </p>
        <span className="shrink-0">
          {value.length}/{WORKFLOW_PROMPT_INSTRUCTIONS_MAX_LENGTH}
        </span>
      </div>
      {node.type === 'review' || node.type === 'decide' ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {translate(
              'workflows.prompt.protocolAppended',
              'Engine appends this decision protocol (not editable):'
            )}
          </p>
          <p className="font-mono text-[11px] leading-relaxed text-foreground/90">
            {workflowDecisionProtocolInstruction(node.type === 'review' ? 'review' : 'decision')}
          </p>
        </div>
      ) : null}
    </section>
  )
}

export function promptInstructionsForTemplateKeyChange(
  node: WorkflowNodeDefinitionV1,
  nextKey: WorkflowPromptTemplateKey | null
): Pick<WorkflowNodeDefinitionV1, 'promptTemplateKey' | 'promptInstructions' | 'inputBindings'> {
  const previousDefault = defaultWorkflowPromptInstructions(node.promptTemplateKey)
  const shouldUseDefault =
    node.promptInstructions == null || node.promptInstructions === previousDefault
  const promptInstructions = shouldUseDefault
    ? nextKey
      ? defaultWorkflowPromptInstructions(nextKey)
      : null
    : node.promptInstructions
  return {
    promptTemplateKey: nextKey,
    promptInstructions,
    inputBindings: promptInstructions
      ? [
          ...new Set([
            ...node.inputBindings,
            ...requiredWorkflowPromptInputBindings(promptInstructions)
          ])
        ]
      : node.inputBindings
  }
}

function promptValidationMessage(
  value: string,
  inspection: ReturnType<typeof inspectWorkflowPromptInstructions>,
  node: WorkflowNodeDefinitionV1
): string {
  if (!value.trim()) {
    return translate(
      'workflows.prompt.instructionsRequired',
      'Agent work instructions are required.'
    )
  }
  if (inspection.malformed) {
    return translate('workflows.prompt.unclosedPlaceholder', 'A placeholder is not closed.')
  }
  if (inspection.unknown.length > 0) {
    return translate('workflows.prompt.unknownPlaceholder', 'Unknown placeholder: {{value0}}', {
      value0: inspection.unknown[0]
    })
  }
  const missingBinding = inspection.placeholders.find((name) => {
    const binding = WORKFLOW_PROMPT_PLACEHOLDERS.find(
      (placeholder) => placeholder.name === name
    )?.inputBinding
    return binding ? !node.inputBindings.includes(binding) : false
  })
  return translate(
    'workflows.prompt.missingInput',
    '{{value0}} needs its matching input enabled.',
    {
      value0: `{{${missingBinding ?? ''}}}`
    }
  )
}

function promptPlaceholderDescription(name: WorkflowPromptPlaceholderName): string {
  switch (name) {
    case 'goal':
    case 'rootGoal':
      return translate('workflows.prompt.rootGoal', 'Workflow root objective')
    case 'criteria':
      return translate('workflows.prompt.completionCriteria', 'Completion criteria')
    case 'currentRound':
      return translate('workflows.prompt.roundVariable', 'Current round')
    case 'nodeId':
      return translate('workflows.visual.nodeId', 'Node ID')
    case 'upstreamCompletion':
      return translate('workflows.prompt.upstreamCompletion', 'Upstream complete conclusion')
    case 'artifactRevision':
      return translate('workflows.prompt.artifactRevision', 'Frozen Artifact Revision')
    case 'reviewAggregate':
      return translate('workflows.prompt.reviewAggregate', 'Current review aggregate')
    case 'humanInstructions':
      return translate('workflows.prompt.humanInstructions', 'Human revision instructions')
    case 'decision':
      return translate('workflows.prompt.decision', 'Latest decision')
    case 'workflowName':
      return translate('workflows.prompt.workflowName', 'Workflow name and version')
    case 'nodeName':
      return translate('workflows.prompt.nodeName', 'Current node name')
    case 'round':
      return translate('workflows.prompt.round', 'Current round')
  }
}
