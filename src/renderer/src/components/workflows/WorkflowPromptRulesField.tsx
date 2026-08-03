import { useMemo, useState } from 'react'
import { Braces } from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1,
  WorkflowPromptRulesV1
} from '../../../../shared/workflow-definition-types'
import {
  defaultWorkflowPromptInstructions,
  inspectWorkflowPromptInstructions
} from '../../../../shared/workflow-prompt-instructions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
  const [historyTarget, setHistoryTarget] = useState(
    () => promptRules.rules.find((rule) => rule.when === 'repeat-visit')?.id ?? ''
  )

  const updatePromptRules = (next: WorkflowPromptRulesV1): void => {
    updateNode((current) => ({ ...current, promptRules: next }))
  }
  const updateRule = (
    ruleId: string,
    update: (rule: WorkflowPromptRulesV1['rules'][number]) => WorkflowPromptRulesV1['rules'][number]
  ): void => {
    updatePromptRules({
      ...promptRules,
      rules: promptRules.rules.map((rule) => (rule.id === ruleId ? update(rule) : rule))
    })
  }
  const appendToken = (ruleId: string, token: string): void => {
    updateRule(ruleId, (rule) => ({
      ...rule,
      template: `${rule.template}${rule.template.endsWith('\n') ? '' : '\n'}${token}`
    }))
  }

  return (
    <div className="space-y-4">
      <section>
        <h4 className="text-xs font-semibold">
          {translate('workflows.prompt.rulesTitle', 'Prompt rules')}
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {translate(
            'workflows.prompt.rulesBoundaryHint',
            'First visit and repeat visit are separate required boundaries. Both remain visible while editing.'
          )}
        </p>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        {promptRules.rules.map((rule) => {
          const inspection = inspectWorkflowPromptInstructions(rule.template)
          const negativeHistory = inspection.historyReferences.some(
            (reference) => typeof reference.round === 'number' && reference.round < 0
          )
          const boundaryError =
            rule.when === 'first-visit' && negativeHistory
              ? translate(
                  'workflows.prompt.firstNegativeHistory',
                  'First visit cannot reference a negative history cycle.'
                )
              : rule.when === 'repeat-visit' &&
                  inspection.historyReferences.length === 0 &&
                  promptRules.repeatVisitHistoryMode !== 'not-required'
                ? translate(
                    'workflows.prompt.repeatNeedsHistory',
                    'Add a history reference or explicitly declare that history is not required.'
                  )
                : null
          return (
            <section
              key={rule.id}
              className="space-y-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">{boundaryLabel(rule.when)}</p>
                  <p className="text-[11px] text-muted-foreground">{rule.name}</p>
                </div>
                <Button
                  size="xs"
                  type="button"
                  variant={historyTarget === rule.id ? 'secondary' : 'ghost'}
                  disabled={readOnly}
                  onClick={() => setHistoryTarget(rule.id)}
                >
                  {translate('workflows.prompt.historyTarget', 'History target')}
                </Button>
              </div>
              <label className="space-y-1">
                <span className="text-[11px] font-medium">
                  {translate('workflows.prompt.ruleName', 'Rule name')}
                </span>
                <Input
                  value={rule.name}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateRule(rule.id, (current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium">
                  {translate('workflows.prompt.template', 'Editable prompt template')}
                </span>
                <Textarea
                  value={rule.template}
                  readOnly={readOnly}
                  aria-invalid={
                    inspection.malformed ||
                    Boolean(inspection.unknown.length) ||
                    Boolean(boundaryError)
                  }
                  className="scrollbar-sleek min-h-48 max-h-[40vh] resize-y overflow-y-auto text-xs leading-relaxed"
                  onFocus={() => setHistoryTarget(rule.id)}
                  onChange={(event) =>
                    updateRule(rule.id, (current) => ({
                      ...current,
                      template: event.target.value
                    }))
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
                    onClick={() => appendToken(rule.id, token)}
                  >
                    <Braces />
                    {label}
                  </Button>
                ))}
              </div>
              {boundaryError ? (
                <p className="text-[11px] text-destructive">{boundaryError}</p>
              ) : null}
            </section>
          )
        })}
      </div>

      <WorkflowHistoryReferencePicker
        definition={definition}
        node={node}
        readOnly={readOnly || !historyTarget}
        onInsert={(token) => appendToken(historyTarget, token)}
      />

      <label className="flex items-start gap-2 rounded-md border border-border p-3 text-xs">
        <Checkbox
          checked={promptRules.repeatVisitHistoryMode === 'not-required'}
          disabled={readOnly}
          onCheckedChange={(checked) =>
            updatePromptRules({
              ...promptRules,
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
      </label>
    </div>
  )
}

function boundaryLabel(when: string): string {
  return when === 'repeat-visit'
    ? translate('workflows.prompt.repeatVisit', 'Repeat visit')
    : translate('workflows.prompt.firstVisit', 'First visit')
}

function effectivePromptRules(node: WorkflowNodeDefinitionV1): WorkflowPromptRulesV1 {
  const legacy =
    node.promptInstructions ?? defaultWorkflowPromptInstructions(node.promptTemplateKey)
  const source = node.promptRules
  const fallback = withCompletionCriteria(legacy || '{{goal}}')
  const first =
    source?.rules.find((rule) => rule.when === 'first-visit') ??
    source?.rules.find((rule) => rule.when === 'always')
  const repeat =
    source?.rules.find((rule) => rule.when === 'repeat-visit') ??
    source?.rules.find((rule) => rule.when === 'always')
  return {
    rules: [
      {
        id: 'first-visit',
        name: first?.name ?? 'First visit',
        when: 'first-visit',
        template: first?.template ?? fallback
      },
      {
        id: 'repeat-visit',
        name: repeat?.name ?? 'Repeat visit',
        when: 'repeat-visit',
        template: repeat?.template ?? fallback
      }
    ],
    completionCriteria:
      source?.completionCriteria ??
      translate(
        'workflows.prompt.defaultCriteria',
        'Return a complete final response that satisfies the workflow goal.'
      ),
    repeatVisitHistoryMode: source?.repeatVisitHistoryMode
  }
}

function withCompletionCriteria(template: string): string {
  return inspectWorkflowPromptInstructions(template).placeholders.includes('criteria')
    ? template
    : `${template}\n\n完成条件：\n{{criteria}}`
}
