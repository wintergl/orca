import { Copy } from 'lucide-react'
import type React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function AgentActivityConclusionCopyButton({
  conclusion
}: {
  conclusion: string
}): React.JSX.Element {
  const copy = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(conclusion)
      toast.success(
        translate(
          'auto.components.right.sidebar.AgentActivityCompletedRow.conclusionCopied',
          'Conclusion copied'
        )
      )
    } catch {
      toast.error(
        translate(
          'auto.components.right.sidebar.AgentActivityCompletedRow.copyConclusionFailed',
          'Failed to copy conclusion'
        )
      )
    }
  }
  const label = translate(
    'auto.components.right.sidebar.AgentActivityCompletedRow.copyConclusion',
    'Copy conclusion'
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          onClick={() => void copy()}
        >
          <Copy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
