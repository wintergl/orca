import { useState } from 'react'
import { Bot, GitBranch, ShieldQuestion, Square } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1
} from '../../../../shared/workflow-definition-types'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { updateWorkflowNode } from './workflow-definition-editing'
import { WorkflowPromptRulesField } from './WorkflowPromptRulesField'
import { WorkflowStepRoleSettings } from './WorkflowStepRoleSettings'
import { WorkflowTransitionFields } from './WorkflowTransitionFields'

type ConfigurationTab = 'basic' | 'prompt' | 'flow'

export function WorkflowNodeConfigurationPanel({
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
  const supportsPrompt = node.type !== 'human-gate' && node.type !== 'complete'
  const [tab, setTab] = useState<ConfigurationTab>(supportsPrompt ? 'prompt' : 'basic')
  const Icon = nodeIcon(node)
  const updateNode = (
    update: (current: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1
  ): void => {
    onChange(updateWorkflowNode(definition, node.id, update))
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{node.name}</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {translate('workflows.visual.nodeId', 'Node ID')}: {node.id}
          </p>
        </div>
      </header>

      <Tabs
        value={tab}
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(value) => setTab(value as ConfigurationTab)}
      >
        <TabsList className="mx-4 mt-3 grid w-auto shrink-0 grid-cols-3">
          <TabsTrigger value="basic">{translate('workflows.visual.basicTab', 'Basic')}</TabsTrigger>
          <TabsTrigger value="prompt" disabled={!supportsPrompt}>
            {translate('workflows.visual.promptTab', 'Prompt')}
          </TabsTrigger>
          <TabsTrigger value="flow">{translate('workflows.visual.flowTab', 'Flow')}</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent
            value="basic"
            forceMount
            className="scrollbar-sleek m-0 h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden"
          >
            <section className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium">
                  {translate('workflows.visual.stepName', 'Step name')}
                </span>
                <Input
                  value={node.name}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateNode((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">
                  {translate('workflows.visual.stableNodeId', 'Stable node ID')}
                </span>
                <Input value={node.id} readOnly className="font-mono text-xs" />
                <span className="block text-[11px] text-muted-foreground">
                  {translate(
                    'workflows.visual.stableNodeIdHint',
                    'Prompt history references keep using this ID when the name changes.'
                  )}
                </span>
              </label>
            </section>
            <WorkflowStepRoleSettings
              definition={definition}
              node={node}
              readOnly={readOnly}
              onChange={onChange}
            />
          </TabsContent>

          <TabsContent
            value="prompt"
            forceMount
            className="scrollbar-sleek m-0 h-full min-h-0 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden"
          >
            {supportsPrompt ? (
              <WorkflowPromptRulesField
                definition={definition}
                node={node}
                readOnly={readOnly}
                updateNode={updateNode}
              />
            ) : null}
          </TabsContent>

          <TabsContent
            value="flow"
            forceMount
            className="scrollbar-sleek m-0 h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden"
          >
            <WorkflowTransitionFields
              definition={definition}
              node={node}
              transitions={definition.transitions.filter(
                (transition) => transition.from === node.id
              )}
              readOnly={readOnly}
              onChange={onChange}
            />
            {node.type !== 'complete' ? (
              <RetryPolicyFields node={node} readOnly={readOnly} updateNode={updateNode} />
            ) : null}
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  )
}

function RetryPolicyFields({
  node,
  readOnly,
  updateNode
}: {
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  updateNode: (update: (node: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <div>
        <h4 className="text-xs font-medium">
          {translate('workflows.visual.retryPolicy', 'Retry policy')}
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {translate(
            'workflows.visual.retryPolicyHint',
            'Retries stay inside the current round; route loops create a new round.'
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label={translate('workflows.visual.maxRetries', 'Maximum attempts')}
          value={node.retryPolicy.maxAttempts}
          min={0}
          max={20}
          disabled={readOnly}
          onChange={(maxAttempts) =>
            updateNode((current) => ({
              ...current,
              retryPolicy: { ...current.retryPolicy, maxAttempts }
            }))
          }
        />
        <NumberInput
          label={translate('workflows.visual.retryIntervalSeconds', 'Interval (seconds)')}
          value={Math.round(node.retryPolicy.backoffMs / 1000)}
          min={0}
          max={3600}
          disabled={readOnly}
          onChange={(seconds) =>
            updateNode((current) => ({
              ...current,
              retryPolicy: { ...current.retryPolicy, backoffMs: seconds * 1000 }
            }))
          }
        />
      </div>
    </section>
  )
}

function NumberInput({
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
      <span className="text-[11px] font-medium">{label}</span>
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

function nodeIcon(node: WorkflowNodeDefinitionV1): React.ComponentType<{ className?: string }> {
  if (node.type === 'decide') {
    return GitBranch
  }
  if (node.type === 'human-gate') {
    return ShieldQuestion
  }
  if (node.type === 'complete') {
    return Square
  }
  return Bot
}
