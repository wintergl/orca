import { ChevronDown, FileText, PanelTopOpen } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { canOpenAiVaultSessionLogInOrca } from './ai-vault-session-path-actions'
import { openAiVaultSessionLogInOrca } from './ai-vault-session-log-open'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import { AgentActivityConclusionCopyButton } from './AgentActivityConclusionCopyButton'
import type { AgentActivityItem } from './agent-activity-model'

function agentLabel(item: AgentActivityItem): string {
  return item.runtimeAgent
    ? getAgentLabel(item.runtimeAgent)
    : translate('auto.components.right.sidebar.AgentActivityCompletedRow.agent', 'Agent')
}

export function AgentActivityCompletedRow({
  item,
  canOpenOriginalPane,
  onOpenOriginalPane
}: {
  item: AgentActivityItem
  canOpenOriginalPane: boolean
  onOpenOriginalPane: (session: NonNullable<AgentActivityItem['matchedSession']>) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const matchedSession = item.matchedSession
  const canOpenLog = Boolean(matchedSession && canOpenAiVaultSessionLogInOrca(matchedSession))
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1.5 px-2 py-1.5 hover:bg-sidebar-accent/60">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="mt-0.5 text-muted-foreground">
            <AgentIcon agent={item.runtimeAgent ?? item.vaultAgent} size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="truncate text-[11px] font-medium text-sidebar-foreground">
              {agentLabel(item)}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">{item.title}</span>
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
        {item.completionMessage ? (
          <AgentActivityConclusionCopyButton conclusion={item.completionMessage} />
        ) : null}
        {canOpenLog && matchedSession ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={translate(
                  'auto.components.right.sidebar.AgentActivityCompletedRow.openLog',
                  'Open log'
                )}
                onClick={() => void openAiVaultSessionLogInOrca(matchedSession)}
              >
                <FileText className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate(
                'auto.components.right.sidebar.AgentActivityCompletedRow.openLog',
                'Open log'
              )}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {canOpenOriginalPane && matchedSession ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={translate(
                  'auto.components.right.sidebar.AgentActivityCompletedRow.openOriginalPane',
                  'Open original pane'
                )}
                onClick={() => onOpenOriginalPane(matchedSession)}
              >
                <PanelTopOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate(
                'auto.components.right.sidebar.AgentActivityCompletedRow.openOriginalPane',
                'Open original pane'
              )}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {expanded && item.message ? (
        <div className="px-2 pb-2">
          <CommentMarkdown
            content={item.message}
            className="max-h-44 overflow-auto scrollbar-sleek rounded border border-sidebar-border bg-sidebar px-2 py-1.5 text-[11px] leading-relaxed"
          />
        </div>
      ) : null}
    </div>
  )
}
