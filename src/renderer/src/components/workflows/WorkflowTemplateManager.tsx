import { useMemo, useState } from 'react'
import { Copy, FilePlus2, FolderCog, RotateCcw, Search, Trash2 } from 'lucide-react'
import type {
  WorkflowTemplateRecord,
  WorkflowTemplateScope
} from '../../../../shared/workflow-definition-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'

type ScopeFilter = WorkflowTemplateScope | 'all'

export function WorkflowTemplateManager({
  open,
  templates,
  selectedTemplateId,
  onOpenChange,
  onNew,
  onOpen,
  onCopy,
  onDelete,
  onResetDefaults
}: {
  open: boolean
  templates: readonly WorkflowTemplateRecord[]
  selectedTemplateId: string | null
  onOpenChange: (open: boolean) => void
  onNew: () => void
  onOpen: (template: WorkflowTemplateRecord) => void
  onCopy: (template: WorkflowTemplateRecord) => Promise<void>
  onDelete: (template: WorkflowTemplateRecord) => Promise<void>
  onResetDefaults: () => Promise<void>
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const visibleTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return templates.filter((template) => {
      const matchesScope = scope === 'all' || template.scope === scope
      const matchesQuery =
        !normalizedQuery || template.name.toLocaleLowerCase().includes(normalizedQuery)
      return matchesScope && matchesQuery
    })
  }, [query, scope, templates])

  const createNew = (): void => {
    onNew()
    onOpenChange(false)
  }

  const openTemplate = (template: WorkflowTemplateRecord): void => {
    onOpen(template)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[min(34rem,92vw)] sm:max-w-[34rem]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2">
            <FolderCog className="size-4" />
            {translate('workflows.templates.manageTitle', 'Workflow management')}
          </SheetTitle>
          <SheetDescription>
            {translate(
              'workflows.templates.manageDescription',
              'Create, find, open, copy, and delete workflow configurations.'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={createNew}>
              <FilePlus2 />
              {translate('workflows.templates.newWorkflow', 'New workflow')}
            </Button>
            <Button variant="outline" onClick={() => void onResetDefaults()}>
              <RotateCcw />
              {translate('workflows.templates.resetDefaults', 'Reset defaults')}
            </Button>
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                className="pl-9"
                aria-label={translate(
                  'workflows.templates.searchAria',
                  'Search workflow templates'
                )}
                placeholder={translate('workflows.templates.search', 'Search templates')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Select value={scope} onValueChange={(value) => setScope(value as ScopeFilter)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{translate('workflows.scope.all', 'All')}</SelectItem>
                <SelectItem value="built-in">
                  {translate('workflows.scope.default', 'Default')}
                </SelectItem>
                <SelectItem value="personal">
                  {translate('workflows.scope.personal', 'Personal')}
                </SelectItem>
                <SelectItem value="project">
                  {translate('workflows.scope.project', 'Project')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-4">
            {visibleTemplates.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                selected={template.id === selectedTemplateId}
                onOpen={() => openTemplate(template)}
                onCopy={() => void onCopy(template)}
                onDelete={() => void onDelete(template)}
              />
            ))}
            {visibleTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                {translate('workflows.templates.noMatches', 'No matching templates')}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function TemplateRow({
  template,
  selected,
  onOpen,
  onCopy,
  onDelete
}: {
  template: WorkflowTemplateRecord
  selected: boolean
  onOpen: () => void
  onCopy: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div
      className={`group rounded-lg border p-3 transition-colors ${
        selected ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <button className="min-w-0 flex-1 text-left" type="button" onClick={onOpen}>
          <span className="block truncate text-sm font-medium">{template.name}</span>
          <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{scopeLabel(template.scope)}</Badge>
            <span>v{template.currentVersion}</span>
            <span>{formatUpdatedAt(template.updatedAt)}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={translate('workflows.templates.copy', 'Copy')}
            onClick={onCopy}
          >
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            aria-label={translate('workflows.templates.delete', 'Delete')}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  )
}

function scopeLabel(scope: WorkflowTemplateScope): string {
  return scope === 'built-in'
    ? translate('workflows.scope.default', 'Default')
    : translate(`workflows.scope.${scope}`, scope)
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined).format(date)
}
