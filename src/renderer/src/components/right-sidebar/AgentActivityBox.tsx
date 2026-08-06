import { useState } from 'react'
import type React from 'react'
import { AgentActivityCurrentRow } from './AgentActivityCurrentRow'
import type { AgentActivityModel } from './agent-activity-model'
import { translate } from '@/i18n/i18n'
import type { WorkflowAgentDisplayContext } from '../workflows/workflow-renderer-state'

export function AgentActivityBox({
  model,
  workflowContextByLifecycleId
}: {
  model: AgentActivityModel
  workflowContextByLifecycleId: ReadonlyMap<string, WorkflowAgentDisplayContext>
}): React.JSX.Element | null {
  const [idleExpanded, setIdleExpanded] = useState(false)
  if (model.counts.attention === 0 && model.counts.working === 0 && model.counts.idle === 0) {
    return null
  }
  const idle = idleExpanded ? model.idle : model.idle.slice(0, 3)
  const summary = [
    model.counts.attention
      ? translate(
          'auto.components.right.sidebar.AgentActivityBox.attentionCount',
          '{{count}} needs attention',
          { count: model.counts.attention }
        )
      : null,
    model.counts.working
      ? translate(
          'auto.components.right.sidebar.AgentActivityBox.workingCount',
          '{{count}} working',
          { count: model.counts.working }
        )
      : null,
    model.counts.idle
      ? translate('auto.components.right.sidebar.AgentActivityBox.idleCount', '{{count}} idle', {
          count: model.counts.idle
        })
      : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="border-b border-sidebar-border px-2 py-2">
      <div className="rounded-md border border-sidebar-border bg-[color:color-mix(in_srgb,var(--sidebar-foreground)_3%,var(--sidebar))]">
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-2 py-1.5">
          <span className="text-[11px] font-medium text-sidebar-foreground">
            {translate('auto.components.right.sidebar.AgentActivityBox.title', 'Agent activity')}
          </span>
          <span className="text-[10px] text-muted-foreground">{summary}</span>
        </div>
        <div className="divide-y divide-sidebar-border/70">
          {model.attention.map((item) => (
            <AgentActivityCurrentRow
              key={item.id}
              item={item}
              workflowContext={workflowContextByLifecycleId.get(item.agentLifecycleId ?? '')}
            />
          ))}
          {model.working.map((item) => (
            <AgentActivityCurrentRow
              key={item.id}
              item={item}
              workflowContext={workflowContextByLifecycleId.get(item.agentLifecycleId ?? '')}
            />
          ))}
          {idle.map((item) => (
            <AgentActivityCurrentRow
              key={item.id}
              item={item}
              workflowContext={workflowContextByLifecycleId.get(item.agentLifecycleId ?? '')}
            />
          ))}
          {model.counts.idle > 3 ? (
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:bg-sidebar-accent/60"
              onClick={() => setIdleExpanded((value) => !value)}
            >
              {idleExpanded
                ? translate(
                    'auto.components.right.sidebar.AgentActivityBox.showFewerIdle',
                    'Show fewer idle agents'
                  )
                : translate(
                    'auto.components.right.sidebar.AgentActivityBox.moreIdle',
                    '{{count}} more idle agents',
                    { count: model.counts.idle - 3 }
                  )}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
