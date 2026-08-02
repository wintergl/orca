import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowRunRecord,
  WorkflowRunHistoryFilter,
  WorkflowRunStatus,
  WorkflowRunSummary
} from '../../../../shared/workflow-definition-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { listWorkflowRuns, showWorkflowRun } from './workflow-runtime-client'
import type { WorkflowWorkspaceContext } from './use-workflow-workspace-context'
import { WorkflowRunDetail } from './WorkflowRunDetail'
import {
  WorkflowRunHistoryFilters,
  type WorkflowHistoryTemplateOption
} from './WorkflowRunHistoryFilters'

type HistoryScope = 'workspace' | 'project'
type HistoryStatus = 'all' | WorkflowRunStatus

export function WorkflowRunHistory({
  target,
  context,
  activeRun,
  selectedStepRunId,
  onRunUpdated,
  onBackToSetup
}: {
  target: RuntimeClientTarget
  context: WorkflowWorkspaceContext | null
  activeRun: WorkflowRunRecord | null
  selectedStepRunId: string | null
  onRunUpdated: (run: WorkflowRunRecord) => void
  onBackToSetup: () => void
}): React.JSX.Element {
  const [scope, setScope] = useState<HistoryScope>('project')
  const [status, setStatus] = useState<HistoryStatus>('all')
  const [templateId, setTemplateId] = useState('all')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [query, setQuery] = useState('')
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [templateOptions, setTemplateOptions] = useState<WorkflowHistoryTemplateOption[]>([])
  const [selectedRun, setSelectedRun] = useState<WorkflowRunRecord | null>(activeRun)
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const activeRunId = activeRun?.id ?? null
  const baseFilter = useMemo<WorkflowRunHistoryFilter>(
    () => ({
      projectIdentity: context?.projectIdentity,
      workspace:
        scope === 'workspace' && context
          ? { kind: context.workspaceKind, id: context.workspaceId }
          : undefined,
      statuses: status === 'all' ? undefined : [status],
      createdFrom: dateBoundary(createdFrom, 'start'),
      createdTo: dateBoundary(createdTo, 'end'),
      limit: 500
    }),
    [context, createdFrom, createdTo, scope, status]
  )
  const requestKey = JSON.stringify({ target, baseFilter, templateId })
  const loading = loadedRequestKey !== requestKey

  useEffect(() => {
    let cancelled = false
    const filtered = listWorkflowRuns(target, {
      ...baseFilter,
      templateId: templateId === 'all' ? undefined : templateId
    })
    const options = templateId === 'all' ? filtered : listWorkflowRuns(target, baseFilter)
    void Promise.all([filtered, options])
      .then(([summaries, optionRuns]) => {
        if (cancelled) {
          return
        }
        setRuns(summaries)
        setTemplateOptions((previous) => workflowTemplateOptions(optionRuns, previous, templateId))
      })
      .catch((error) => {
        if (!cancelled) {
          setRuns([])
          toast.error(
            error instanceof Error
              ? error.message
              : translate('workflows.history.loadError', 'Could not load Workflow history')
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedRequestKey(requestKey)
        }
      })
    return () => {
      cancelled = true
    }
  }, [baseFilter, requestKey, target, templateId])

  useEffect(() => {
    const selectedStillVisible = selectedRun && runs.some((run) => run.id === selectedRun.id)
    const activeStillVisible = activeRunId && runs.some((run) => run.id === activeRunId)
    const preferredId = selectedStillVisible
      ? selectedRun.id
      : activeStillVisible
        ? activeRunId
        : (runs[0]?.id ?? null)
    if (!preferredId) {
      setSelectedRun(null)
      return
    }
    if (selectedRun?.id === preferredId) {
      return
    }
    let cancelled = false
    void showWorkflowRun(target, preferredId)
      .then((run) => {
        if (!cancelled) {
          setSelectedRun(run)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate('workflows.history.openError', 'Could not open Workflow run')
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeRunId, runs, selectedRun, target])

  const visibleRuns = useMemo(
    () =>
      deferredQuery
        ? runs.filter((run) =>
            `${run.templateName}\n${run.objective}\n${run.id}`
              .toLocaleLowerCase()
              .includes(deferredQuery)
          )
        : runs,
    [deferredQuery, runs]
  )

  const openRun = async (summary: WorkflowRunSummary): Promise<void> => {
    try {
      const run = await showWorkflowRun(target, summary.id)
      setSelectedRun(run)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('workflows.history.openError', 'Could not open Workflow run')
      )
    }
  }

  return (
    <div
      data-workflow-run-history="true"
      className="grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(12rem,1fr)_minmax(0,4fr)]"
    >
      <aside className="scrollbar-sleek min-h-0 overflow-y-auto border-r border-border bg-muted/20">
        <WorkflowRunHistoryFilters
          query={query}
          scope={scope}
          status={status}
          templateId={templateId}
          templateOptions={templateOptions}
          createdFrom={createdFrom}
          createdTo={createdTo}
          onQueryChange={setQuery}
          onScopeChange={setScope}
          onStatusChange={setStatus}
          onTemplateChange={setTemplateId}
          onCreatedFromChange={setCreatedFrom}
          onCreatedToChange={setCreatedTo}
        />
        <div className="space-y-1 p-2">
          {loading ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />{' '}
              {translate('workflows.history.loading', 'Loading history…')}
            </p>
          ) : visibleRuns.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {translate('workflows.history.empty', 'No matching Workflow runs.')}
            </p>
          ) : (
            visibleRuns.map((run) => (
              <button
                type="button"
                key={run.id}
                data-current={selectedRun?.id === run.id}
                className={cn(
                  'w-full rounded-md px-2 py-2 text-left hover:bg-accent',
                  selectedRun?.id === run.id && 'bg-accent'
                )}
                onClick={() => void openRun(run)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{run.templateName}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                      {run.objective || run.id}
                    </span>
                    {run.isRerun ? (
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {translate('workflows.history.anotherRound', 'Another round')}
                        {run.parentRunId ? ` · ${run.parentRunId.slice(-8)}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {run.status}
                  </Badge>
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {formatTimestamp(run.startedAt ?? run.createdAt)}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      {selectedRun ? (
        <WorkflowRunDetail
          run={selectedRun}
          target={target}
          selectedStepRunId={selectedStepRunId}
          onBackToSetup={onBackToSetup}
          onRunUpdated={(run) => {
            setSelectedRun(run)
            if (activeRun?.id === run.id) {
              onRunUpdated(run)
            }
          }}
          onRerunCreated={(child) => {
            setSelectedRun(child)
            onRunUpdated(child)
            setLoadedRequestKey(null)
          }}
        />
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {translate('workflows.history.selectRun', 'Select a Workflow run.')}
        </div>
      )}
    </div>
  )
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function dateBoundary(value: string, edge: 'start' | 'end'): string | undefined {
  if (!value) {
    return undefined
  }
  const suffix = edge === 'start' ? 'T00:00:00.000' : 'T23:59:59.999'
  const parsed = new Date(`${value}${suffix}`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function workflowTemplateOptions(
  runs: WorkflowRunSummary[],
  previous: WorkflowHistoryTemplateOption[],
  selectedTemplateId: string
): WorkflowHistoryTemplateOption[] {
  const templates = new Map(runs.map((run) => [run.templateId, run.templateName]))
  if (selectedTemplateId !== 'all' && !templates.has(selectedTemplateId)) {
    const selected = previous.find((template) => template.id === selectedTemplateId)
    if (selected) {
      templates.set(selected.id, selected.name)
    }
  }
  return [...templates]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
