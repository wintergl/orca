import { useState } from 'react'
import { toast } from 'sonner'
import {
  AgentSessionCreationForm,
  type AgentSessionCreationOption,
  type AgentSessionCreationRequest
} from '@/components/agents/AgentSessionCreationForm'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

export function AgentCreationDialog({
  open,
  agents,
  detecting,
  onOpenChange,
  onCreateProfile
}: {
  open: boolean
  agents: readonly AgentSessionCreationOption[]
  detecting: boolean
  onOpenChange: (open: boolean) => void
  onCreateProfile: (request: AgentSessionCreationRequest) => Promise<void> | void
}): React.JSX.Element {
  const [creating, setCreating] = useState(false)

  const createAgent = async (request: AgentSessionCreationRequest): Promise<void> => {
    if (creating) {
      return
    }
    setCreating(true)
    try {
      await onCreateProfile(request)
      onOpenChange(false)
      toast.success(
        translate(
          'auto.components.settings.AgentCreationDialog.created',
          '{{value0}} was saved and is ready to launch.',
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
          commandRequired
          detecting={detecting}
          heading={translate(
            'auto.components.settings.AgentCreationDialog.title',
            'Create a new Agent'
          )}
          description={translate(
            'auto.components.settings.AgentCreationDialog.description',
            'Choose a base Agent, then give it a provider-specific name and launch command.'
          )}
          onCreate={(request) => void createAgent(request)}
        />
      </DialogContent>
    </Dialog>
  )
}
