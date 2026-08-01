import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { workflowResolutionActionLabel } from './workflow-resolution-action-label'

export function WorkflowReviewPolicySummary({
  definition
}: {
  definition: WorkflowDefinitionV1
}): React.JSX.Element | null {
  const policies = definition.nodes
    .filter((node) => node.type === 'review')
    .map((review) => reviewPolicy(definition, review.id))
  if (policies.length === 0) {
    return null
  }
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">
          {translate('workflows.application.reviewPolicy', 'Review and revision')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {translate(
            'workflows.application.reviewPolicyHint',
            'These rules are frozen from the selected template for this run.'
          )}
        </p>
      </div>
      <div className="space-y-3">
        {policies.map((policy) => (
          <article
            key={policy.reviewId}
            className="rounded-md border border-border bg-muted/20 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">{policy.reviewName}</p>
              <Badge variant="secondary">
                {translate('workflows.application.maxRounds', 'Maximum {{count}} rounds', {
                  count: policy.maxRounds
                })}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <PolicyValue
                label={translate('workflows.application.decisionMethod', 'Decision method')}
                value={
                  policy.decisionMode === 'rules-then-agent'
                    ? translate(
                        'workflows.application.rulesThenAgent',
                        'Rules, then assigned Decision Agent'
                      )
                    : translate('workflows.application.rulesOnly', 'Rules automatically')
                }
              />
              <PolicyValue
                label={translate('workflows.application.reviewersNeeded', 'Reviewers required')}
                value={String(policy.minReviewers)}
              />
            </dl>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <p>{translate('workflows.application.approveRule', 'All approve → continue')}</p>
              <p>
                {translate(
                  'workflows.application.reviseRule',
                  'Any revise or blocker → return for revision'
                )}
              </p>
              <p>
                {translate(
                  'workflows.application.humanRule',
                  'Request-human or conflicting verdicts → human intervention'
                )}
              </p>
            </div>
            <p className="mt-3 rounded-md border border-border bg-background px-2.5 py-2 text-[11px]">
              {translate(
                'workflows.application.humanBudgetRule',
                'Return for revision records human instructions and starts a new consumable round budget. The operator chooses its size before continuing.'
              )}
            </p>
            {policy.humanActions.length > 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('workflows.application.humanActions', 'Human actions')}:{' '}
                {policy.humanActions.map(workflowResolutionActionLabel).join(' · ')}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function PolicyValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

function reviewPolicy(definition: WorkflowDefinitionV1, reviewId: string) {
  const review = definition.nodes.find(
    (node): node is Extract<WorkflowDefinitionV1['nodes'][number], { type: 'review' }> =>
      node.id === reviewId && node.type === 'review'
  )!
  const reviewExit = definition.transitions.find(
    (transition) => transition.from === reviewId && transition.when === 'step:succeeded'
  )
  const decision = definition.nodes.find(
    (node) => node.id === reviewExit?.to && node.type === 'decide'
  )
  const humanExit = definition.transitions.find(
    (transition) => transition.from === decision?.id && transition.when === 'decision:request-human'
  )
  const humanGate = definition.nodes.find(
    (node) => node.id === humanExit?.to && node.type === 'human-gate'
  )
  return {
    reviewId,
    reviewName: review.name,
    maxRounds: review.reviewPolicy.maxReviewRounds,
    minReviewers: review.reviewPolicy.minReviewers,
    decisionMode: decision?.type === 'decide' ? decision.mode : 'rules',
    humanActions: humanGate?.type === 'human-gate' ? humanGate.allowedActions : []
  }
}
