import { ChevronDown, Copy } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { aiVaultAgentLabel } from '../../../../shared/ai-vault-types'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import type { AgentConclusionItem } from './agent-conclusions'

function formatConclusionTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function agentLabel(item: AgentConclusionItem): string {
  if (item.runtimeAgent) {
    return getAgentLabel(item.runtimeAgent)
  }
  return item.vaultAgent ? aiVaultAgentLabel(item.vaultAgent) : 'Agent'
}

export function AgentConclusionsBox({
  items
}: {
  items: readonly AgentConclusionItem[]
}): React.JSX.Element | null {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (items.length === 0) {
    return null
  }

  const copyConclusion = async (item: AgentConclusionItem): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(item.message)
      toast.success(
        translate(
          'auto.components.right.sidebar.AgentConclusionsBox.copySuccess',
          'Conclusion copied'
        )
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.right.sidebar.AgentConclusionsBox.copyFailure',
              'Failed to copy conclusion'
            )
      )
    }
  }

  return (
    <section className="border-b border-sidebar-border px-2 py-2">
      <div className="rounded-md border border-sidebar-border bg-[color:color-mix(in_srgb,var(--sidebar-foreground)_3%,var(--sidebar))]">
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-2 py-1.5">
          <div className="min-w-0 text-[11px] font-medium text-sidebar-foreground">
            {translate(
              'auto.components.right.sidebar.AgentConclusionsBox.title',
              'Recent agent conclusions'
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">{items.length}</div>
        </div>

        <div className="divide-y divide-sidebar-border/70">
          {items.map((item) => {
            const expanded = expandedId === item.id
            const label = agentLabel(item)
            return (
              <div key={item.id} className="min-w-0">
                <div className="flex min-w-0 items-start gap-1.5 px-2 py-1.5 hover:bg-sidebar-accent/60">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                  >
                    <span className="mt-0.5 text-muted-foreground">
                      <AgentIcon agent={item.runtimeAgent ?? item.vaultAgent} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-[11px] font-medium text-sidebar-foreground">
                          {label}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatConclusionTime(item.completedAt)}
                        </span>
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/90">
                        {item.message}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-180'
                      )}
                    />
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-sidebar-foreground"
                        aria-label={translate(
                          'auto.components.right.sidebar.AgentConclusionsBox.copyConclusion',
                          'Copy conclusion'
                        )}
                        onClick={() => void copyConclusion(item)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {translate(
                        'auto.components.right.sidebar.AgentConclusionsBox.copyConclusion',
                        'Copy conclusion'
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>

                {expanded ? (
                  <div className="px-2 pb-2">
                    <CommentMarkdown
                      content={item.message}
                      className="max-h-44 overflow-auto scrollbar-sleek rounded border border-sidebar-border bg-sidebar px-2 py-1.5 text-[11px] leading-relaxed"
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
