import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Loader2 } from 'lucide-react'
import type { TuiAgent } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

export type AgentSessionCreationOption = {
  selectionId?: string
  id: TuiAgent
  label: string
  commandHint: string
  defaultCommand?: string
  supportsYolo: boolean
  defaultYolo: boolean
}

export type AgentSessionCreationRequest = {
  title: string
  agent: TuiAgent
  agentCommand?: string
  permissionMode?: 'yolo' | 'manual'
}

export function AgentSessionCreationForm({
  agents,
  creating,
  commandRequired = false,
  creationDisabled = false,
  detecting = false,
  heading,
  description,
  onBack,
  onCreate
}: {
  agents: readonly AgentSessionCreationOption[]
  creating: boolean
  commandRequired?: boolean
  creationDisabled?: boolean
  detecting?: boolean
  heading: string
  description: string
  onBack?: () => void
  onCreate: (request: AgentSessionCreationRequest) => void
}): React.JSX.Element {
  const [selectionId, setSelectionId] = useState<string | null>(
    agents[0]?.selectionId ?? agents[0]?.id ?? null
  )
  const [agentName, setAgentName] = useState(agents[0]?.label ?? '')
  const [command, setCommand] = useState(agents[0]?.defaultCommand ?? '')
  const selected = useMemo(
    () =>
      agents.find((agent) => (agent.selectionId ?? agent.id) === selectionId) ?? agents[0] ?? null,
    [selectionId, agents]
  )
  const [yolo, setYolo] = useState(selected?.defaultYolo ?? false)

  useEffect(() => {
    if (selectionId === null && agents[0]) {
      setSelectionId(agents[0].selectionId ?? agents[0].id)
      setAgentName(agents[0].label)
      setCommand(agents[0].defaultCommand ?? '')
      setYolo(agents[0].defaultYolo)
    }
  }, [selectionId, agents])

  const selectAgent = (nextSelectionId: string): void => {
    const next = agents.find((agent) => (agent.selectionId ?? agent.id) === nextSelectionId)
    setSelectionId(nextSelectionId)
    setAgentName(next?.label ?? '')
    setCommand(next?.defaultCommand ?? '')
    setYolo(next?.defaultYolo ?? false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {onBack ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={creating}
            aria-label={translate('workflows.agentPicker.back', 'Back to idle Agents')}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <div>
          <p className="text-sm font-medium">{heading}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      {selected ? (
        <div className="space-y-4 rounded-md border border-border p-3">
          <div className="space-y-2">
            <Label htmlFor="new-agent-name">
              {translate('workflows.agentPicker.agentName', 'Agent name')}
            </Label>
            <Input
              id="new-agent-name"
              value={agentName}
              disabled={creating}
              autoFocus
              onChange={(event) => setAgentName(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'workflows.agentPicker.agentNameHint',
                'Use a custom name and launch command for provider aliases such as cc, codexdb, or codexdba.'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-agent-type">
              {translate('workflows.agentPicker.agentType', 'Base Agent')}
            </Label>
            <Select
              value={selected.selectionId ?? selected.id}
              disabled={creating}
              onValueChange={selectAgent}
            >
              <SelectTrigger id="new-agent-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem
                    key={agent.selectionId ?? agent.id}
                    value={agent.selectionId ?? agent.id}
                  >
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'workflows.agentPicker.nameFollowsCatalog',
                'The base Agent controls hooks, session handling, and prompt delivery.'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-agent-command">
              {translate('workflows.agentPicker.command', 'Launch command')}
            </Label>
            <Input
              id="new-agent-command"
              value={command}
              disabled={creating}
              className="font-mono"
              placeholder={selected.commandHint}
              onChange={(event) => setCommand(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {commandRequired
                ? translate(
                    'workflows.agentPicker.commandRequiredHint',
                    'Enter the exact command this custom Agent should run.'
                  )
                : translate(
                    'workflows.agentPicker.commandHint',
                    'Leave blank to use the base Agent command configured for this execution host.'
                  )}
            </p>
          </div>

          {selected.supportsYolo ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2.5">
              <Checkbox
                id="new-agent-yolo"
                checked={yolo}
                disabled={creating}
                onCheckedChange={(checked) => setYolo(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="new-agent-yolo">
                  {translate('workflows.agentPicker.yolo', 'YOLO permissions')}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {translate(
                    'workflows.agentPicker.yoloHint',
                    'Skip supported permission prompts for this Agent session only.'
                  )}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : detecting ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('workflows.agentPicker.detectingAgents', 'Detecting installed Agents…')}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {translate(
            'workflows.agentPicker.noCreatableAgents',
            'No enabled Agent is installed on this execution host.'
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={
            !selected ||
            !agentName.trim() ||
            (commandRequired && !command.trim()) ||
            creating ||
            creationDisabled
          }
          onClick={() => {
            const title = agentName.trim()
            if (!selected || !title) {
              return
            }
            const agentCommand = command.trim()
            onCreate({
              title,
              agent: selected.id,
              ...(agentCommand ? { agentCommand } : {}),
              ...(selected.supportsYolo ? { permissionMode: yolo ? 'yolo' : 'manual' } : {})
            })
          }}
        >
          {creating ? <Loader2 className="animate-spin" /> : <Bot />}
          {creating
            ? translate('workflows.agentPicker.creating', 'Creating…')
            : translate('workflows.agentPicker.create', 'Create Agent')}
        </Button>
      </div>
    </div>
  )
}
