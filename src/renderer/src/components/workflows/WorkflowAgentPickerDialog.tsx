import { useMemo, useState } from 'react'
import { Bot, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { WorkflowAssignableAgent } from './workflow-renderer-state'
import {
  WorkflowNewAgentForm,
  type WorkflowNewAgentOption,
  type WorkflowNewAgentRequest
} from './WorkflowNewAgentForm'

const EMPTY_CREATABLE_AGENTS: readonly WorkflowNewAgentOption[] = []

export function WorkflowAgentPickerDialog({
  open,
  agents,
  creatableAgents = EMPTY_CREATABLE_AGENTS,
  creatingAgent = false,
  detectingCreatableAgents = false,
  onOpenChange,
  onSelect,
  onCreate
}: {
  open: boolean
  agents: readonly WorkflowAssignableAgent[]
  creatableAgents?: readonly WorkflowNewAgentOption[]
  creatingAgent?: boolean
  detectingCreatableAgents?: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (agent: WorkflowAssignableAgent) => void
  onCreate?: (request: WorkflowNewAgentRequest) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized
      ? agents.filter((agent) =>
          [agent.label, agent.runtimeAgent, agent.currentTask]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalized))
        )
      : agents
  }, [agents, query])
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!creatingAgent) {
          onOpenChange(nextOpen)
          if (!nextOpen) {
            setCreating(false)
            setQuery('')
          }
        }
      }}
    >
      <DialogContent className="max-w-lg">
        {creating ? (
          <WorkflowNewAgentForm
            agents={creatableAgents}
            creating={creatingAgent}
            detecting={detectingCreatableAgents}
            onBack={() => setCreating(false)}
            onCreate={(request) => onCreate?.(request)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('workflows.agentPicker.title', 'Assign an idle Agent')}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'workflows.agentPicker.description',
                  'Choose an idle Agent, or create one in this Draft workspace.'
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate('workflows.agentPicker.search', 'Search Agents')}
                aria-label={translate(
                  'workflows.agentPicker.searchAria',
                  'Search assignable Agents'
                )}
                className="pl-8"
              />
            </div>
            <div className="scrollbar-sleek max-h-72 space-y-1 overflow-y-auto">
              {filtered.map((agent) => (
                <Button
                  key={agent.id}
                  variant="ghost"
                  className="h-auto w-full justify-start px-3 py-2 text-left"
                  onClick={() => onSelect(agent)}
                >
                  <Bot className="size-4" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{agent.label}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {agent.currentTask ??
                        translate('workflows.agentPicker.idle', 'Open and currently idle')}
                    </span>
                  </span>
                </Button>
              ))}
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {translate('workflows.agentPicker.empty', 'No assignable idle Agents')}
                </p>
              ) : null}
            </div>
            {onCreate ? (
              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setCreating(true)}
                >
                  <Plus />
                  {translate('workflows.agentPicker.newAgent', 'Create new Agent')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
