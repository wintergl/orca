import { useState } from 'react'
import { toast } from 'sonner'
import {
  AgentSessionCreationForm,
  type AgentSessionCreationOption,
  type AgentSessionCreationRequest
} from '@/components/agents/AgentSessionCreationForm'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { launchAgentBackgroundSession } from '@/lib/launch-agent-background-session'
import { useAppStore } from '@/store'

export function AgentCreationDialog({
  open,
  agents,
  detecting,
  onOpenChange
}: {
  open: boolean
  agents: readonly AgentSessionCreationOption[]
  detecting: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)

  const createAgent = async (request: AgentSessionCreationRequest): Promise<void> => {
    if (!activeWorktreeId || creating) {
      return
    }
    setCreating(true)
    try {
      const result = await launchAgentBackgroundSession({
        ...request,
        worktreeId: activeWorktreeId,
        launchSource: 'unknown'
      })
      if (!result) {
        throw new Error(
          translate(
            'auto.components.settings.AgentCreationDialog.launchFailed',
            'Could not build the Agent launch command.'
          )
        )
      }
      const store = useAppStore.getState()
      onOpenChange(false)
      store.closeSettingsPage()
      store.setActiveTab(result.tabId)
      store.setActiveTabType('terminal')
      toast.success(
        translate(
          'auto.components.settings.AgentCreationDialog.created',
          '{{value0}} was created in a new tab.',
          { value0: request.title }
        )
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.settings.AgentCreationDialog.createFailed',
              'Could not create the Agent.'
            )
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !creating && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-lg">
        <AgentSessionCreationForm
          agents={agents}
          creating={creating}
          creationDisabled={!activeWorktreeId}
          detecting={detecting}
          heading={translate(
            'auto.components.settings.AgentCreationDialog.title',
            'Create a new Agent'
          )}
          description={
            activeWorktreeId
              ? translate(
                  'auto.components.settings.AgentCreationDialog.description',
                  'Start an Agent in the active workspace. Its catalog name becomes the tab name.'
                )
              : translate(
                  'auto.components.settings.AgentCreationDialog.noWorkspace',
                  'Open a workspace before creating an Agent.'
                )
          }
          onCreate={(request) => void createAgent(request)}
        />
      </DialogContent>
    </Dialog>
  )
}
