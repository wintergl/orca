import { translate } from '@/i18n/i18n'
import {
  AgentSessionCreationForm,
  type AgentSessionCreationOption,
  type AgentSessionCreationRequest
} from '@/components/agents/AgentSessionCreationForm'

export type WorkflowNewAgentOption = AgentSessionCreationOption
export type WorkflowNewAgentRequest = AgentSessionCreationRequest

export function WorkflowNewAgentForm({
  agents,
  creating,
  detecting = false,
  onBack,
  onCreate
}: {
  agents: readonly WorkflowNewAgentOption[]
  creating: boolean
  detecting?: boolean
  onBack: () => void
  onCreate: (request: WorkflowNewAgentRequest) => void
}): React.JSX.Element {
  return (
    <AgentSessionCreationForm
      agents={agents}
      creating={creating}
      detecting={detecting}
      heading={translate('workflows.agentPicker.createTitle', 'Create a new Agent')}
      description={translate(
        'workflows.agentPicker.createDescription',
        'The Agent starts in this Draft workspace and is assigned when it becomes idle.'
      )}
      onBack={onBack}
      onCreate={onCreate}
    />
  )
}
