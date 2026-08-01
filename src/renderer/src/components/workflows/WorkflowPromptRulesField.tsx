import { useMemo, useState } from 'react'
import { Braces } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowPromptRulesV1,
  WorkflowPromptRuleWhen
} from '../../../../shared/workflow-definition-types'
import {
  defaultWorkflowPromptInstructions,
  inspectWorkflowPromptInstructions
} from '../../../../shared/workflow-prompt-instructions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { WorkflowHistoryReferencePicker } from './WorkflowHistoryReferencePicker'

export function WorkflowPromptRulesField({
  definition,
  node,
  readOnly,
  updateNode
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  readOnly: boolean
  updateNode: (update: (node: WorkflowNodeDefinitionV1) => WorkflowNodeDefinitionV1) => void
}): React.JSX.Element {
  const promptRules = useMemo(() => effectivePromptRules(node), [node])
  const [selectedRuleId, setSelectedRuleId] = useState(promptRules.rules[0]?.id ?? '')
  const selectedRule =
    promptRules.rules.find((rule) => rule.id === selectedRuleId) ?? promptRules.rules[0]

  const updatePromptRules = (next: WorkflowPromptRulesV1): void => {
    updateNode((current) => ({ ...current, promptRules: next }))
  }
  const updateSelectedRule = (
    update: (rule: WorkflowPromptRulesV1['rules'][number]) => WorkflowPromptRulesV1['rules'][number]
  ): void => {
    if (!selectedRule) {
      return
    }
    updatePromptRules({
      ...promptRules,
      rules: promptRules.rules.map((rule) => (rule.id === selectedRule.id ? update(rule) : rule))
    })
  }
  const appendToken = (token: string): void => {
    updateSelectedRule((rule) => ({
      ...rule,
      template: `${rule.template}${rule.template.endsWith('\n') ? '' : '\n'}${token}`
    }))
  }
  const inspection = selectedRule ? inspectWorkflowPromptInstructions(selectedRule.template) : null

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div>
          <h4 className="text-xs font-semibold">
            {translate('workflows.prompt.rulesTitle', 'Prompt rules')}
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {translate(
              'workflows.prompt.rulesHint',
              'Orca selects one rule from the node visit state before sending the message.'
            )}
          </p>
        </div>
        <Tabs value={selectedRule?.id} onValueChange={setSelectedRuleId}>
          <TabsList className="grid h-auto w-full grid-cols-2">
            {promptRules.rules.map((rule) => (
              <TabsTrigger key={rule.id} value={rule.id} className="min-w-0 px-2 py-1.5">
                <span className="truncate">{rule.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </section>

      {selectedRule ? (
        <section className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium">
                {translate('workflows.prompt.ruleName', 'Rule name')}
              </span>
              <Input
                value={selectedRule.name}
                readOnly={readOnly}
                onChange={(event) =>
                  updateSelectedRule((rule) => ({ ...rule, name: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium">
                {translate('workflows.prompt.enterWhen', 'Use when')}
              </span>
              <Select
                value={selectedRule.when}
                disabled={readOnly}
                onValueChange={(when) =>
                  updateSelectedRule((rule) => ({
                    ...rule,
                    when: when as WorkflowPromptRuleWhen
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first-visit">
                    {translate('workflows.prompt.firstVisit', 'First visit')}
                  </SelectItem>
                  <SelectItem value="repeat-visit">
                    {translate('workflows.prompt.repeatVisit', 'Repeat visit')}
                  </SelectItem>
                  <SelectItem value="always">
                    {translate('workflows.prompt.always', 'Always')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium">
              {translate('workflows.prompt.template', 'Editable prompt template')}
            </span>
            <Textarea
              value={selectedRule.template}
              readOnly={readOnly}
              aria-invalid={inspection?.malformed === true || Boolean(inspection?.unknown.length)}
              className="min-h-44 max-h-[40vh] resize-y overflow-y-auto overscroll-contain text-xs leading-relaxed"
              onChange={(event) =>
                updateSelectedRule((rule) => ({ ...rule, template: event.target.value }))
              }
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['{{goal}}', translate('workflows.prompt.goalVariable', 'Goal')],
              ['{{criteria}}', translate('workflows.prompt.criteriaVariable', 'Criteria')],
              ['{{currentRound}}', translate('workflows.prompt.roundVariable', 'Current round')]
            ].map(([token, label]) => (
              <Button
                key={token}
                type="button"
                size="xs"
                variant="outline"
                disabled={readOnly}
                onClick={() => appendToken(token)}
              >
                <Braces />
                {label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <WorkflowHistoryReferencePicker
        definition={definition}
        node={node}
        readOnly={readOnly || !selectedRule}
        onInsert={appendToken}
      />

      <label className="block space-y-1">
        <span className="text-xs font-medium">
          {translate('workflows.prompt.completionCriteria', 'Completion criteria')}
        </span>
        <Textarea
          value={promptRules.completionCriteria}
          readOnly={readOnly}
          className="min-h-20 text-xs leading-relaxed"
          onChange={(event) =>
            updatePromptRules({ ...promptRules, completionCriteria: event.target.value })
          }
        />
        <span className="block text-[11px] text-muted-foreground">
          {translate(
            'workflows.prompt.criteriaHint',
            'Insert {{criteria}} wherever the Agent should receive this condition.'
          )}
        </span>
      </label>
    </div>
  )
}

function effectivePromptRules(node: WorkflowNodeDefinitionV1): WorkflowPromptRulesV1 {
  if (node.promptRules) {
    return node.promptRules
  }
  const legacy =
    node.promptInstructions ?? defaultWorkflowPromptInstructions(node.promptTemplateKey)
  const compatibleTemplate = withCompletionCriteria(legacy || '{{goal}}')
  return {
    rules: [
      {
        id: 'first-visit',
        name: translate('workflows.prompt.firstVersion', 'Generate first version'),
        when: 'first-visit',
        template: compatibleTemplate
      },
      {
        id: 'repeat-visit',
        name: translate('workflows.prompt.reviseFromHistory', 'Revise from history'),
        when: 'repeat-visit',
        template: compatibleTemplate
      }
    ],
    completionCriteria: translate(
      'workflows.prompt.defaultCriteria',
      'Return a complete final response that satisfies the workflow goal.'
    )
  }
}

function withCompletionCriteria(template: string): string {
  if (inspectWorkflowPromptInstructions(template).placeholders.includes('criteria')) {
    return template
  }
  return `${template}\n\n完成条件：\n{{criteria}}`
}
