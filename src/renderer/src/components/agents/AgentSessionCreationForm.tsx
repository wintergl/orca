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
  id: TuiAgent
  label: string
  commandHint: string
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
  creationDisabled = false,
  detecting = false,
  heading,
  description,
  onBack,
  onCreate
}: {
  agents: readonly AgentSessionCreationOption[]
  creating: boolean
  creationDisabled?: boolean
  detecting?: boolean
  heading: string
  description: string
  onBack?: () => void
  onCreate: (request: AgentSessionCreationRequest) => void
}): React.JSX.Element {
  const [agentId, setAgentId] = useState<TuiAgent | null>(agents[0]?.id ?? null)
  const [command, setCommand] = useState('')
  const selected = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? agents[0] ?? null,
    [agentId, agents]
  )
  const [yolo, setYolo] = useState(selected?.defaultYolo ?? false)

  useEffect(() => {
    if (agentId === null && agents[0]) {
      setAgentId(agents[0].id)
      setYolo(agents[0].defaultYolo)
    }
  }, [agentId, agents])

  const selectAgent = (nextId: TuiAgent): void => {
    const next = agents.find((agent) => agent.id === nextId)
    setAgentId(nextId)
    setCommand('')
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
            <Label htmlFor="new-agent-type">
              {translate('workflows.agentPicker.agentType', 'Agent')}
            </Label>
            <Select value={selected.id} disabled={creating} onValueChange={selectAgent}>
              <SelectTrigger id="new-agent-type" className="w-full" autoFocus>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'workflows.agentPicker.nameFollowsCatalog',
                'The Agent and its new tab use this name. Renaming the tab also updates Workflow.'
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
              {translate(
                'workflows.agentPicker.commandHint',
                'Leave blank to use the Agent command configured for this execution host.'
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
          disabled={!selected || creating || creationDisabled}
          onClick={() => {
            if (!selected) {
              return
            }
            const agentCommand = command.trim()
            onCreate({
              title: selected.label,
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
