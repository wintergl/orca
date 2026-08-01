import { Loader2, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { sendHiToAgentActivity, type AgentActivityHiSendResult } from './agent-activity-hi-send'
import type { AgentActivityItem } from './agent-activity-types'

type DeliveryState = 'sending' | 'sent' | null

function unavailableReason(item: AgentActivityItem, delivery: DeliveryState): string | null {
  if (delivery === 'sending') {
    return translate('auto.components.right.sidebar.AgentActivityHiButton.sending', 'Sending Hi…')
  }
  if (delivery === 'sent') {
    return translate('auto.components.right.sidebar.AgentActivityHiButton.sent', 'Hi sent')
  }
  if (item.kind === 'working') {
    return translate(
      'auto.components.right.sidebar.AgentActivityHiButton.agentWorking',
      'Agent is working'
    )
  }
  if (item.kind === 'attention') {
    return translate(
      'auto.components.right.sidebar.AgentActivityHiButton.agentNeedsPermission',
      'Agent is waiting for permission'
    )
  }
  if (item.kind !== 'idle') {
    return translate(
      'auto.components.right.sidebar.AgentActivityHiButton.agentNotIdle',
      'Agent is not idle'
    )
  }
  if (!item.navigationTarget?.ptyId) {
    switch (item.navigationUnavailableReason) {
      case 'host-unresolved':
        return translate(
          'auto.components.right.sidebar.AgentActivityHiButton.executionHostUnavailable',
          'Execution host is unavailable'
        )
      case 'identity-ambiguous':
        return translate(
          'auto.components.right.sidebar.AgentActivityHiButton.identityAmbiguous',
          'Agent identity is ambiguous'
        )
      case 'remote-disconnected':
        return translate(
          'auto.components.right.sidebar.AgentActivityHiButton.remoteDisconnected',
          'Remote host is disconnected'
        )
      case 'lifecycle-missing':
        return translate(
          'auto.components.right.sidebar.AgentActivityHiButton.lifecycleMissing',
          'Agent lifecycle is unavailable'
        )
      case 'title-only-evidence':
      case 'pane-unavailable':
      case null:
        break
    }
    return translate(
      'auto.components.right.sidebar.AgentActivityHiButton.terminalUnavailable',
      'Agent terminal is unavailable'
    )
  }
  return null
}

function failureMessage(result: Exclude<AgentActivityHiSendResult, 'sent'>): string {
  switch (result) {
    case 'agent-changed':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.agentChanged',
        'The Agent changed before Hi could be sent.'
      )
    case 'terminal-unavailable':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.terminalClosed',
        'The Agent terminal is closed or unavailable.'
      )
    case 'not-idle':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.noLongerIdle',
        'The Agent is no longer idle.'
      )
    case 'permission':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.permissionRequired',
        'The Agent is waiting for permission.'
      )
    case 'status-unavailable':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.statusUnavailable',
        'Orca could not safely verify that this Agent is idle.'
      )
    case 'runtime-unavailable':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.runtimeUnavailable',
        'The Agent runtime is unreachable.'
      )
    case 'not-writable':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.notWritable',
        'The Agent terminal did not accept Hi.'
      )
    case 'partial-submit-failed':
      return translate(
        'auto.components.right.sidebar.AgentActivityHiButton.submitFailed',
        'Hi may be pasted in the Agent terminal, but Orca could not submit it.'
      )
  }
}

export function AgentActivityHiButton({ item }: { item: AgentActivityItem }): React.JSX.Element {
  const [delivery, setDelivery] = useState<DeliveryState>(null)
  const sendingRef = useRef(false)

  const disabledReason = unavailableReason(item, delivery)
  const label = translate('auto.components.right.sidebar.AgentActivityHiButton.sendHi', 'Send Hi')
  const sendHi = async (): Promise<void> => {
    if (disabledReason || sendingRef.current) {
      return
    }
    sendingRef.current = true
    setDelivery('sending')
    try {
      const result = await sendHiToAgentActivity(item)
      if (result === 'sent') {
        setDelivery('sent')
        toast.success(
          translate('auto.components.right.sidebar.AgentActivityHiButton.sent', 'Hi sent')
        )
        return
      }
      sendingRef.current = false
      setDelivery(null)
      toast.error(failureMessage(result))
    } catch {
      sendingRef.current = false
      setDelivery(null)
      toast.error(
        translate(
          'auto.components.right.sidebar.AgentActivityHiButton.sendFailed',
          'Failed to send Hi.'
        )
      )
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          aria-disabled={disabledReason !== null}
          className={cn(
            'opacity-0 transition-opacity group-hover/agent-row:opacity-100 focus-visible:opacity-100',
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-40'
          )}
          onClick={() => void sendHi()}
        >
          {delivery === 'sending' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {disabledReason ?? label}
      </TooltipContent>
    </Tooltip>
  )
}
