import { createHash } from 'node:crypto'
import type {
  WorkflowEventRecord,
  WorkflowRunExportFormat,
  WorkflowRunExportResult,
  WorkflowRunRecord
} from '../../../shared/workflow-definition-types'
import { WorkflowError } from './workflow-error'
import type { WorkflowHistoryEntryV2 } from '../../../shared/workflow-definition-v2-types'

const MAX_EXPORT_BYTES = 16 * 1024 * 1024
const SECRET_KEY_RE =
  /(?:token|secret|password|credential|authorization|api[-_]?key|environment|env)$/i
const SECRET_VALUE_RE =
  /(\b(?:token|secret|password|authorization|api[-_]?key)\b\s*[:=]\s*)([^\s,;]+)/gi
const POSIX_USER_PATH_RE = /\/Users\/[^/]+|\/home\/[^/]+/g
const WINDOWS_USER_PATH_RE = /[A-Za-z]:\\Users\\[^\\]+/g

type WorkflowExportSnapshot = {
  schema: 'workflow.run-export/v2'
  run: WorkflowRunRecord
  events: WorkflowEventRecord[]
  v2History: WorkflowHistoryEntryV2[]
}

export function exportWorkflowRun(
  run: WorkflowRunRecord,
  events: WorkflowEventRecord[],
  format: WorkflowRunExportFormat,
  v2History: WorkflowHistoryEntryV2[] = []
): WorkflowRunExportResult {
  const snapshot = redactSnapshot({ schema: 'workflow.run-export/v2', run, events, v2History })
  const canonical = JSON.stringify(snapshot)
  const snapshotDigest = sha256(canonical)
  const content =
    format === 'json'
      ? JSON.stringify({ ...snapshot, snapshotDigest }, null, 2)
      : renderMarkdown(snapshot, snapshotDigest)
  const size = Buffer.byteLength(content)
  if (size > MAX_EXPORT_BYTES) {
    throw new WorkflowError(
      'workflow_export_too_large',
      `Workflow export exceeds the ${MAX_EXPORT_BYTES} byte safety limit.`
    )
  }
  return {
    runId: run.id,
    format,
    filename: safeFilename(`${run.templateName}-${run.id}.${format === 'json' ? 'json' : 'md'}`),
    mimeType: format === 'json' ? 'application/json' : 'text/markdown',
    content,
    digest: sha256(content),
    size
  }
}

function redactSnapshot(snapshot: WorkflowExportSnapshot): WorkflowExportSnapshot {
  const redacted = redactValue(snapshot, '') as WorkflowExportSnapshot
  return {
    ...redacted,
    run: {
      ...redacted.run,
      ownerIdentity: '[redacted]',
      resolutionOffers: []
    }
  }
}

function redactValue(value: unknown, key: string): unknown {
  if (SECRET_KEY_RE.test(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, redactValue(entry, entryKey)])
    )
  }
  return value
}

function redactString(value: string): string {
  return value
    .replace(SECRET_VALUE_RE, '$1[redacted]')
    .replace(POSIX_USER_PATH_RE, '~')
    .replace(WINDOWS_USER_PATH_RE, '~')
}

function renderMarkdown(snapshot: WorkflowExportSnapshot, snapshotDigest: string): string {
  const run = snapshot.run
  const sections = [
    `# Workflow Run: ${run.templateName}`,
    [
      `- Run: \`${run.id}\``,
      `- Status: \`${run.status}\``,
      `- Template: \`${run.templateId}@${run.templateVersion}\``,
      `- Parent / root: \`${run.parentRunId ?? 'none'}\` / \`${run.rootRunId}\``,
      `- Lineage cycle base: ${run.lineageCycleBase}`,
      `- Workspace: \`${run.workspace.kind}:${run.workspace.id}\``,
      `- Execution Host: \`${run.executionHostId}\``,
      `- Started: ${run.startedAt ?? 'not started'}`,
      `- Completed: ${run.completedAt ?? 'not completed'}`,
      `- Snapshot digest: \`${snapshotDigest}\``
    ].join('\n'),
    markdownSection('Root objective', run.objective),
    markdownSection('Rerun reason', run.rerunReason ?? 'No additional requirements.'),
    markdownSection(
      'Run policy overrides',
      codeBlock(JSON.stringify(run.policyOverrides, null, 2), 'json')
    ),
    markdownSection(
      'Run prompt overrides',
      codeBlock(JSON.stringify(run.promptOverrides, null, 2), 'json')
    ),
    ...run.steps.flatMap((step) => [
      `## Step: ${step.nodeName}`,
      [
        `- Step Run: \`${step.id}\``,
        `- Type: \`${step.nodeType}\``,
        `- Status: \`${step.status}\``,
        `- Round / attempt: ${step.round} / ${step.attempt}`,
        `- Delivery: \`${step.deliveryState}\``,
        `- Task / Dispatch: \`${step.taskId ?? 'pending'}\` / \`${step.dispatchId ?? 'pending'}\``
      ].join('\n'),
      markdownSection('Prompt', step.prompt),
      markdownSection('Conclusion', step.conclusionMarkdown ?? 'Not available.')
    ]),
    markdownSection(
      'Artifact revisions',
      codeBlock(JSON.stringify(run.artifacts, null, 2), 'json')
    ),
    markdownSection(
      'Review aggregates',
      codeBlock(JSON.stringify(run.reviewAggregates, null, 2), 'json')
    ),
    markdownSection('Decisions', codeBlock(JSON.stringify(run.decisions, null, 2), 'json')),
    markdownSection(
      'V2 append-only history',
      codeBlock(JSON.stringify(snapshot.v2History, null, 2), 'json')
    ),
    markdownSection('Event timeline', renderEvents(snapshot.events))
  ]
  return `${sections.join('\n\n')}\n`
}

function renderEvents(events: WorkflowEventRecord[]): string {
  return events
    .map(
      (event) =>
        `- #${event.sequence} ${event.createdAt} **${event.type}**${
          event.stepRunId ? ` (\`${event.stepRunId}\`)` : ''
        }\n\n${codeBlock(JSON.stringify(event.payload, null, 2), 'json')}`
    )
    .join('\n')
}

function markdownSection(title: string, content: string): string {
  return `## ${title}\n\n${content}`
}

function codeBlock(content: string, language = ''): string {
  const fence = content.includes('```') ? '````' : '```'
  return `${fence}${language}\n${content}\n${fence}`
}

function safeFilename(value: string): string {
  const withoutControls = [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  return withoutControls.replace(/[<>:"/\\|?*]/g, '-').slice(0, 180)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
