import { useMemo, useState } from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowResolutionOffer,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { workflowReviewRoundsRemaining } from '../../../../shared/workflow-review-round-budget'
import { reassignWorkflowStep, resolveWorkflowRun } from './workflow-runtime-client'
import { useWorkflowRendererState, type WorkflowAssignableAgent } from './workflow-renderer-state'
import { WorkflowAgentPickerDialog } from './WorkflowAgentPickerDialog'
import { WorkflowResolutionDialog } from './WorkflowResolutionDialog'
import { workflowResolutionOfferLabel } from './workflow-resolution-action-label'
import {
  workflowReviewOutcomeLabel,
  workflowWaitingReasonLabel
} from './workflow-runtime-state-labels'

const DIRECT_ACTIONS = new Set<WorkflowResolutionOffer['action']>([
  'approve',
  'revise',
  'continue-round',
  'extend-route-budget',
  'retry-step',
  'retry-with-duplicate-risk',
  'reassign-agent',
  'end-workflow'
])

export function WorkflowResolutionPanel({
  run,
  target,
  onRunUpdated,
  onOpenEvidence
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  onRunUpdated: (run: WorkflowRunRecord) => void
  onOpenEvidence: () => void
}): React.JSX.Element {
  const [selectedOffer, setSelectedOffer] = useState<WorkflowResolutionOffer | null>(null)
  const [reason, setReason] = useState('')
  const [reviewRoundBudget, setReviewRoundBudget] = useState(1)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [reassignAgent, setReassignAgent] = useState<WorkflowAssignableAgent | null>(null)
  const { availableAgents } = useWorkflowRendererState()
  const aggregate = useMemo(
    () =>
      run.reviewAggregates
        .toReversed()
        .find(
          (candidate) =>
            candidate.reviewNodeId === run.resolutionContext?.reviewNodeId &&
            candidate.artifactRevisionId === run.resolutionContext.artifactRevisionId
        ) ?? null,
    [run.resolutionContext, run.reviewAggregates]
  )
  const artifact = run.artifacts.find(
    (candidate) => candidate.id === run.resolutionContext?.artifactRevisionId
  )
  const primaryAction = primaryActionFor(run)
  const reviewNode =
    run.templateSnapshot.schemaVersion === 1
      ? run.templateSnapshot.nodes.find(
          (node) => node.id === run.resolutionContext?.reviewNodeId && node.type === 'review'
        )
      : undefined
  const remainingRounds = aggregate
    ? workflowReviewRoundsRemaining(run, aggregate.reviewNodeId, aggregate.round)
    : null
  const originStep = run.steps.find(
    (step) => step.id === run.resolutionContext?.originDecisionStepId
  )
  const eligibleAgents = availableAgents.filter(
    (agent) =>
      agent.worktreeId === run.workspace.id &&
      agent.executionHostId === run.executionHostId &&
      agent.paneKey !== originStep?.assignment?.paneKey
  )
  const heading =
    run.status === 'review-limit-reached'
      ? translate('workflows.resolution.limit', 'Review limit reached')
      : translate('workflows.resolution.waiting', 'Waiting for human control')
  const waitingReason = run.waitingReason ? workflowWaitingReasonLabel(run.waitingReason) : null

  const choose = (offer: WorkflowResolutionOffer): void => {
    if (offer.action === 'view-evidence') {
      onOpenEvidence()
      return
    }
    if (!DIRECT_ACTIONS.has(offer.action)) {
      toast.info(
        translate(
          'workflows.resolution.dedicatedControl',
          'Use the dedicated recovery control for this action.'
        )
      )
      return
    }
    setReason('')
    setReviewRoundBudget(
      reviewNode?.type === 'review' ? reviewNode.reviewPolicy.maxReviewRounds : 1
    )
    setReassignAgent(null)
    setSelectedOffer(offer)
  }

  const submit = async (): Promise<void> => {
    if (!selectedOffer) {
      return
    }
    setBusy(true)
    try {
      const updated =
        selectedOffer.action === 'reassign-agent' && reassignAgent
          ? await reassignWorkflowStep(
              target,
              run,
              selectedOffer.originDecisionStepId,
              {
                worktreeId: reassignAgent.worktreeId,
                executionHostId: reassignAgent.executionHostId,
                paneKey: reassignAgent.paneKey,
                agentLifecycleId: reassignAgent.agentLifecycleId,
                providerSessionId: reassignAgent.providerSessionId,
                runtimeAgent: reassignAgent.runtimeAgent
              },
              reason.trim()
            )
          : await resolveWorkflowRun(target, run.id, selectedOffer, {
              reason: reason.trim() || undefined,
              reviewRoundBudget: selectedOffer.action === 'revise' ? reviewRoundBudget : undefined,
              routeTraversalBudget:
                selectedOffer.action === 'extend-route-budget' ? reviewRoundBudget : undefined,
              confirmation: true
            })
      onRunUpdated(updated)
      setSelectedOffer(null)
      toast.success(translate('workflows.resolution.applied', 'Workflow state updated'))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.resolution.failed', 'Could not resolve Workflow')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-md border border-sidebar-border bg-muted/30 p-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-sidebar-foreground">{heading}</p>
          {waitingReason && waitingReason !== heading ? (
            <p className="text-[10px] text-muted-foreground">{waitingReason}</p>
          ) : null}
        </div>
        {aggregate ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Badge variant="outline">
              {translate('workflows.resolution.round', 'Round {{round}}', {
                round: aggregate.round
              })}
            </Badge>
            {remainingRounds !== null ? (
              <Badge variant="secondary">
                {translate('workflows.resolution.remainingRounds', '{{count}} remaining', {
                  count: remainingRounds
                })}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      {artifact || aggregate ? (
        <div className="space-y-1 border-t border-sidebar-border pt-2 text-[10px]">
          {artifact ? (
            <p className="flex items-center gap-1 text-muted-foreground">
              <FileText className="size-3" />
              <span className="truncate">
                {translate('workflows.resolution.artifact', 'Artifact revision {{revision}}', {
                  revision: artifact.revision
                })}
              </span>
            </p>
          ) : null}
          {aggregate ? (
            <p className="text-muted-foreground">
              {workflowReviewOutcomeLabel(aggregate.outcome)} ·{' '}
              {translate('workflows.resolution.unresolved', '{{count}} unresolved conflicts', {
                count: aggregate.conflicts.length
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {run.resolutionOffers.map((offer) => (
          <Button
            key={offer.id}
            size="xs"
            variant={offer.action === primaryAction ? 'default' : 'outline'}
            onClick={() => choose(offer)}
          >
            {workflowResolutionOfferLabel(offer)}
          </Button>
        ))}
      </div>
      <WorkflowResolutionDialog
        offer={selectedOffer}
        reason={reason}
        reviewRoundBudget={reviewRoundBudget}
        busy={busy}
        onReasonChange={setReason}
        onReviewRoundBudgetChange={setReviewRoundBudget}
        reassignAgent={reassignAgent}
        onChooseAgent={() => setPickerOpen(true)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOffer(null)
          }
        }}
        onSubmit={() => void submit()}
      />
      <WorkflowAgentPickerDialog
        open={pickerOpen}
        agents={eligibleAgents}
        onOpenChange={setPickerOpen}
        onSelect={(agent) => {
          setReassignAgent(agent)
          setPickerOpen(false)
        }}
      />
    </section>
  )
}

function primaryActionFor(run: WorkflowRunRecord): WorkflowResolutionOffer['action'] | null {
  if (run.waitingReason === 'review-limit-reached') {
    return 'revise'
  }
  if (run.waitingReason === 'review-revision-required' || run.waitingReason === 'review-conflict') {
    return 'revise'
  }
  return run.resolutionOffers.find((offer) => offer.action !== 'view-evidence')?.action ?? null
}
