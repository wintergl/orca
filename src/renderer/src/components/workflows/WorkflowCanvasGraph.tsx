import {
  ArrowRight,
  Bot,
  CircleCheck,
  GitBranch,
  ShieldQuestion,
  UserRoundCheck
} from 'lucide-react'
import type {
  WorkflowDefinitionV1,
  WorkflowNodeDefinitionV1
} from '../../../../shared/workflow-definition-types'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export function WorkflowCanvasGraph({
  definition,
  selectedNodeId,
  onSelectNode
}: {
  definition: WorkflowDefinitionV1
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}): React.JSX.Element {
  const mainNodes = definition.nodes.filter((node) => node.type !== 'human-gate')
  const humanNodes = definition.nodes.filter((node) => node.type === 'human-gate')
  return (
    <div className="flex min-w-[760px] flex-col gap-6 p-10">
      <div className="flex items-center justify-center">
        {mainNodes.map((node, index) => (
          <div key={node.id} className="flex items-center">
            <WorkflowCanvasNode
              definition={definition}
              node={node}
              selected={selectedNodeId === node.id}
              onClick={() => onSelectNode(node.id)}
            />
            {index < mainNodes.length - 1 ? (
              <div className="flex w-9 items-center text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <ArrowRight className="-ml-px size-3.5" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <RouteSummary definition={definition} />
      {humanNodes.length ? (
        <div className="flex justify-end pr-[12%]">
          {humanNodes.map((node) => (
            <WorkflowCanvasNode
              key={node.id}
              definition={definition}
              node={node}
              selected={selectedNodeId === node.id}
              onClick={() => onSelectNode(node.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WorkflowCanvasNode({
  definition,
  node,
  selected,
  onClick
}: {
  definition: WorkflowDefinitionV1
  node: WorkflowNodeDefinitionV1
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  const Icon =
    node.type === 'produce'
      ? Bot
      : node.type === 'review'
        ? UserRoundCheck
        : node.type === 'decide'
          ? GitBranch
          : node.type === 'human-gate'
            ? ShieldQuestion
            : CircleCheck
  const roles = definition.roleSlots.filter((slot) => node.roleSlotIds.includes(slot.id))
  const agents = roles.reduce((total, role) => total + role.maxAgents, 0)
  return (
    <button
      type="button"
      data-current={selected || undefined}
      className={cn(
        'min-w-32 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors',
        selected ? 'border-ring ring-1 ring-ring/60' : 'border-border hover:bg-accent/40',
        node.type === 'human-gate' ? 'border-primary/50' : ''
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{node.name}</span>
        {node.type === 'review' && agents > 1 ? (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {agents} {translate('workflows.run.agent', 'Agent')}
          </span>
        ) : null}
      </span>
      <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
        {translate('workflows.visual.nodeId', 'Node ID')}: {node.id}
      </span>
    </button>
  )
}

function RouteSummary({ definition }: { definition: WorkflowDefinitionV1 }): React.JSX.Element {
  const decision = definition.nodes.find((node) => node.type === 'decide')
  const revise = decision
    ? definition.transitions.find(
        (transition) => transition.from === decision.id && transition.when === 'decision:revise'
      )
    : null
  const human = decision
    ? definition.transitions.find(
        (transition) =>
          transition.from === decision.id && transition.when === 'decision:request-human'
      )
    : null
  const reviewNode = definition.nodes.find(
    (node): node is Extract<WorkflowNodeDefinitionV1, { type: 'review' }> => node.type === 'review'
  )
  const reviewRounds = reviewNode?.reviewPolicy.maxReviewRounds
  if (!decision || (!revise && !human)) {
    return <div className="h-8" />
  }
  return (
    <div className="mx-auto flex w-[72%] items-center gap-3 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {revise ? (
        <span>
          {translate('workflows.visual.nextRound', 'Not complete → next round')}
          {reviewRounds
            ? ` · ${translate('workflows.visual.maxRounds', 'max {{value0}}', { value0: reviewRounds })}`
            : ''}
        </span>
      ) : null}
      {human ? (
        <span>· {translate('workflows.visual.invalidToHuman', 'Invalid → human')}</span>
      ) : null}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
