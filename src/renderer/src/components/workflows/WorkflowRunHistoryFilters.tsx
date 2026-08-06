import { Search } from 'lucide-react'
import type { WorkflowRunStatus } from '../../../../shared/workflow-definition-types'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { workflowRunStatusLabel } from './workflow-runtime-state-labels'

export type WorkflowHistoryTemplateOption = { id: string; name: string }

export function WorkflowRunHistoryFilters({
  query,
  scope,
  status,
  templateId,
  templateOptions,
  createdFrom,
  createdTo,
  onQueryChange,
  onScopeChange,
  onStatusChange,
  onTemplateChange,
  onCreatedFromChange,
  onCreatedToChange
}: {
  query: string
  scope: 'workspace' | 'project'
  status: 'all' | WorkflowRunStatus
  templateId: string
  templateOptions: WorkflowHistoryTemplateOption[]
  createdFrom: string
  createdTo: string
  onQueryChange: (value: string) => void
  onScopeChange: (value: 'workspace' | 'project') => void
  onStatusChange: (value: 'all' | WorkflowRunStatus) => void
  onTemplateChange: (value: string) => void
  onCreatedFromChange: (value: string) => void
  onCreatedToChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-background/95 p-3 backdrop-blur">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={translate('workflows.history.search', 'Search runs')}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={scope} onValueChange={onScopeChange}>
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="workspace">
              {translate('workflows.history.workspace', 'Workspace')}
            </SelectItem>
            <SelectItem value="project">
              {translate('workflows.history.project', 'Project')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {translate('workflows.history.allStates', 'All states')}
            </SelectItem>
            {RUN_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {workflowRunStatusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Select value={templateId} onValueChange={onTemplateChange}>
        <SelectTrigger
          size="sm"
          className="w-full text-xs"
          aria-label={translate('workflows.history.template', 'Template')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('workflows.history.allTemplates', 'All templates')}
          </SelectItem>
          {templateOptions.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[10px] text-muted-foreground">
          <span>{translate('workflows.history.createdFrom', 'From')}</span>
          <Input
            type="date"
            value={createdFrom}
            max={createdTo || undefined}
            onChange={(event) => onCreatedFromChange(event.target.value)}
            className="h-8 px-2 text-xs"
          />
        </label>
        <label className="space-y-1 text-[10px] text-muted-foreground">
          <span>{translate('workflows.history.createdTo', 'To')}</span>
          <Input
            type="date"
            value={createdTo}
            min={createdFrom || undefined}
            onChange={(event) => onCreatedToChange(event.target.value)}
            className="h-8 px-2 text-xs"
          />
        </label>
      </div>
    </div>
  )
}

const RUN_STATUSES: WorkflowRunStatus[] = [
  'draft',
  'ready',
  'running',
  'paused',
  'waiting-human',
  'review-limit-reached',
  'completed',
  'failed',
  'cancelled'
]
