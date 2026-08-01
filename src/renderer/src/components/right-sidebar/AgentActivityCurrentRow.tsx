import type React from 'react'
import { GripVertical } from 'lucide-react'
import { AgentStateDot, agentStateLabel, type AgentDotState } from '@/components/AgentStateDot'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { AgentActivityConclusionCopyButton } from './AgentActivityConclusionCopyButton'
import { AgentActivityHiButton } from './AgentActivityHiButton'
import { aiVaultAgentLabel } from '../../../../shared/ai-vault-types'
import { navigateToAgentActivity } from './agent-activity-navigation'
import type { AgentActivityItem } from './agent-activity-model'
import {
  startWorkflowAgentMouseDrag,
  writeWorkflowAgentDrag
} from '../workflows/workflow-agent-drag'
import type { WorkflowAgentDisplayContext } from '../workflows/workflow-renderer-state'

function dotState(item: AgentActivityItem): AgentDotState {
  return item.state
}

function agentLabel(item: AgentActivityItem): string {
  return item.runtimeAgent
    ? getAgentLabel(item.runtimeAgent)
    : item.vaultAgent
      ? aiVaultAgentLabel(item.vaultAgent)
      : translate('auto.components.right.sidebar.AgentActivityCurrentRow.agent', 'Agent')
}

function summary(item: AgentActivityItem): string {
  if (item.kind === 'working' && item.toolName) {
    return item.toolInput ? `${item.toolName} · ${item.toolInput}` : item.toolName
  }
  if (item.message) {
    return item.message
  }
  return item.kind === 'idle'
    ? translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.openAndIdle',
        'Open and currently idle'
      )
    : agentStateLabel(dotState(item))
}

function formatStateChangedAgo(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }
  const elapsedMs = Math.max(0, Date.now() - timestamp)
  if (elapsedMs < 60_000) {
    return translate('auto.components.right.sidebar.AgentActivityCurrentRow.justNow', 'just now')
  }
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60) {
    return translate(
      'auto.components.right.sidebar.AgentActivityCurrentRow.minutesAgo',
      '{{count}}m ago',
      {
        count: minutes
      }
    )
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return translate(
      'auto.components.right.sidebar.AgentActivityCurrentRow.hoursAgo',
      '{{count}}h ago',
      {
        count: hours
      }
    )
  }
  return translate(
    'auto.components.right.sidebar.AgentActivityCurrentRow.daysAgo',
    '{{count}}d ago',
    { count: Math.floor(hours / 24) }
  )
}

function stateChangedLabel(item: AgentActivityItem): string | null {
  const relativeTime = formatStateChangedAgo(item.stateChangedAt || item.updatedAt)
  return relativeTime
    ? translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.stateChanged',
        'State changed {{time}}',
        { time: relativeTime }
      )
    : null
}

function unavailableReason(item: AgentActivityItem): string {
  switch (item.navigationUnavailableReason) {
    case 'host-unresolved':
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.executionHostUnavailable',
        'Execution host is unavailable'
      )
    case 'identity-ambiguous':
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.sessionIdentityAmbiguous',
        'Session identity is ambiguous'
      )
    case 'remote-disconnected':
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.remoteHostDisconnected',
        'Remote host is disconnected'
      )
    case 'lifecycle-missing':
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.paneIdentifying',
        'Pane is still being identified'
      )
    case 'title-only-evidence':
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.titleOnlyUnavailable',
        'Title-only activity cannot be opened safely'
      )
    case 'pane-unavailable':
    case null:
      return translate(
        'auto.components.right.sidebar.AgentActivityCurrentRow.paneUnavailable',
        'Agent pane is unavailable'
      )
  }
}

export function AgentActivityCurrentRow({
  item,
  workflowContext
}: {
  item: AgentActivityItem
  workflowContext?: WorkflowAgentDisplayContext
}): React.JSX.Element {
  const stateTime = stateChangedLabel(item)
  const workflowAssignable = item.kind === 'idle' && item.navigationTarget !== null
  const content = (
    <>
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        <AgentStateDot state={dotState(item)} size="md" />
        <AgentIcon agent={item.runtimeAgent ?? item.vaultAgent} size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-sidebar-foreground">
            {agentLabel(item)}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {item.kind === 'idle'
              ? translate(
                  'auto.components.right.sidebar.AgentActivityCurrentRow.openIdle',
                  'Open · idle'
                )
              : agentStateLabel(dotState(item))}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate">{item.title}</span>
          {stateTime ? <span className="shrink-0">{stateTime}</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/90">
          {summary(item)}
        </span>
        {workflowContext ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {translate('workflows.activity.agentContext', '{{workflow}} · {{node}} · R{{round}}', {
              workflow: workflowContext.workflowName,
              node: workflowContext.nodeName,
              round: workflowContext.round
            })}
            {workflowContext.sentToNodeName
              ? ` · ${translate(
                  'auto.components.right.sidebar.AgentActivityCurrentRow.sentToNode',
                  'sent to {{node}}',
                  { node: workflowContext.sentToNodeName }
                )}`
              : ''}
          </span>
        ) : null}
      </span>
    </>
  )
  if (!item.navigationTarget) {
    return (
      <div
        className="group/agent-row flex min-w-0 items-start gap-2 px-2 py-1.5"
        aria-label={translate(
          'auto.components.right.sidebar.AgentActivityCurrentRow.paneUnavailableAria',
          'Agent pane unavailable'
        )}
      >
        {content}
        {item.completionMessage ? (
          <AgentActivityConclusionCopyButton conclusion={item.completionMessage} />
        ) : null}
        <AgentActivityHiButton key={`${item.id}:${item.kind}`} item={item} />
        <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">
          {unavailableReason(item)}
        </span>
      </div>
    )
  }
  return (
    <div className="group/agent-row flex min-w-0 items-start gap-1.5 px-2 py-1.5 hover:bg-sidebar-accent/60">
      <button
        type="button"
        className={cn(
          'flex min-w-0 flex-1 items-start gap-2 text-left',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring'
        )}
        draggable={workflowAssignable}
        onDragStart={(event) => writeWorkflowAgentDrag(event, item)}
        onClick={() => navigateToAgentActivity(item)}
      >
        {content}
      </button>
      {workflowAssignable ? (
        <span
          className="mt-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent active:cursor-grabbing"
          onMouseDown={(event) => startWorkflowAgentMouseDrag(event, item)}
          aria-label={translate(
            'auto.components.right.sidebar.AgentActivityCurrentRow.dragIdleAgent',
            'Drag idle Agent'
          )}
          title={translate(
            'auto.components.right.sidebar.AgentActivityCurrentRow.dragIdleAgent',
            'Drag idle Agent'
          )}
        >
          <GripVertical className="size-3.5" />
        </span>
      ) : null}
      {item.completionMessage ? (
        <AgentActivityConclusionCopyButton conclusion={item.completionMessage} />
      ) : null}
      <AgentActivityHiButton key={`${item.id}:${item.kind}`} item={item} />
    </div>
  )
}
