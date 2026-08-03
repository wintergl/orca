import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import type {
  WorkflowRunPolicyOverrides,
  WorkflowRunPromptOverrides
} from '../../../../shared/workflow-run-lineage'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { createWorkflowRunRerun } from './workflow-runtime-client'
import { WorkflowRunPolicyConfiguration } from './WorkflowRunPolicyConfiguration'
import { WorkflowRunPromptOverrideFields } from './WorkflowRunPromptOverrides'
import {
  effectivePromptOverrides,
  effectiveRunPolicy,
  runPolicyOverrideForSave,
  runPromptOverridesForSave
} from './workflow-run-configuration-state'

export function WorkflowRunRerunButton({
  run,
  target,
  onRerunCreated
}: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  onRerunCreated?: (run: WorkflowRunRecord) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [objective, setObjective] = useState(run.objective)
  const [reason, setReason] = useState('')
  const [noAdditional, setNoAdditional] = useState(false)
  const [copyAssignments, setCopyAssignments] = useState(true)
  const [policy, setPolicy] = useState<WorkflowRunPolicyOverrides>(() => effectiveRunPolicy(run))
  const [prompts, setPrompts] = useState<WorkflowRunPromptOverrides>(() =>
    effectivePromptOverrides(run)
  )
  const recent = useMemo(() => recentConclusions(run), [run])

  useEffect(() => {
    if (!open) {
      setObjective(run.objective)
      setReason('')
      setNoAdditional(false)
      setCopyAssignments(true)
      setPolicy(effectiveRunPolicy(run))
      setPrompts(effectivePromptOverrides(run))
    }
  }, [open, run])

  if (run.status !== 'completed') {
    return null
  }
  const valid = Boolean(reason.trim()) !== noAdditional
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{translate('workflows.run.anotherRound', 'Another round')}</Button>
      </DialogTrigger>
      <DialogContent className="scrollbar-sleek max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{translate('workflows.run.anotherRound', 'Another round')}</DialogTitle>
          <DialogDescription>
            {translate(
              'workflows.run.anotherRoundHint',
              'Create a child Draft from the workflow entry. The completed parent remains immutable.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ParentEvidence run={run} recent={recent} />
          <label className="block space-y-1">
            <span className="text-xs font-medium">
              {translate('workflows.application.objective', 'Task objective')}
            </span>
            <Textarea
              value={objective}
              className="min-h-24"
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">
              {translate('workflows.run.additionalRequirements', 'Additional requirements')}
            </span>
            <Textarea
              value={reason}
              disabled={noAdditional}
              className="min-h-24"
              placeholder={translate(
                'workflows.run.additionalRequirementsPlaceholder',
                'Describe what should change in this round'
              )}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <CheckRow
            checked={noAdditional}
            label={translate(
              'workflows.run.noAdditionalRequirements',
              'No additional requirements; repeat with the same objective'
            )}
            onChange={(checked) => {
              setNoAdditional(checked)
              if (checked) {
                setReason('')
              }
            }}
          />
          <CheckRow
            checked={copyAssignments}
            label={translate('workflows.run.copyAssignments', 'Copy current Agent assignments')}
            onChange={setCopyAssignments}
          />
          <WorkflowRunPolicyConfiguration run={run} value={policy} onChange={setPolicy} />
          <WorkflowRunPromptOverrideFields run={run} value={prompts} onChange={setPrompts} />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={rerunning} onClick={() => setOpen(false)}>
            {translate('common.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={rerunning || !valid || !objective.trim()}
            onClick={() =>
              void createRerun({
                run,
                target,
                objective,
                reason,
                noAdditional,
                copyAssignments,
                policy,
                prompts,
                setRerunning,
                setOpen,
                onRerunCreated
              })
            }
          >
            {translate('workflows.run.createChildDraft', 'Create child Draft')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ParentEvidence({
  run,
  recent
}: {
  run: WorkflowRunRecord
  recent: string[]
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
      <p className="font-medium">{run.templateName}</p>
      <p className="mt-1 text-muted-foreground">
        {translate('workflows.run.parentRun', 'Parent Run')}: {run.id}
      </p>
      {recent.map((text, index) => (
        <p key={`${index}:${text}`} className="mt-2 line-clamp-3 whitespace-pre-wrap">
          {text}
        </p>
      ))}
    </section>
  )
}

function CheckRow({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 text-xs">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span>{label}</span>
    </label>
  )
}

function recentConclusions(run: WorkflowRunRecord): string[] {
  return run.steps
    .filter((step) => step.status === 'succeeded' && step.conclusionMarkdown?.trim())
    .toSorted((left, right) => right.completedAt!.localeCompare(left.completedAt!))
    .slice(0, 3)
    .map((step) => `${step.nodeName}: ${step.conclusionMarkdown}`)
}

async function createRerun(params: {
  run: WorkflowRunRecord
  target: RuntimeClientTarget
  objective: string
  reason: string
  noAdditional: boolean
  copyAssignments: boolean
  policy: WorkflowRunPolicyOverrides
  prompts: WorkflowRunPromptOverrides
  setRerunning: (value: boolean) => void
  setOpen: (value: boolean) => void
  onRerunCreated?: (run: WorkflowRunRecord) => void
}): Promise<void> {
  params.setRerunning(true)
  try {
    const child = await createWorkflowRunRerun(params.target, {
      parentRunId: params.run.id,
      rerunReason: params.noAdditional ? null : params.reason,
      noAdditionalRequirements: params.noAdditional,
      objective: params.objective,
      policyOverrides: runPolicyOverrideForSave(params.run, params.policy),
      promptOverrides: runPromptOverridesForSave(params.prompts),
      copyAssignments: params.copyAssignments
    })
    params.onRerunCreated?.(child)
    params.setOpen(false)
    toast.success(translate('workflows.run.rerunCreated', 'Child Draft created for another round.'))
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('workflows.run.rerunFailed', 'Could not create another round.')
    )
  } finally {
    params.setRerunning(false)
  }
}
