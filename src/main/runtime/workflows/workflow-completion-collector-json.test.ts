import { inspect } from 'node:util'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import {
  failureDiagnosticFromError,
  takeWorkflowRawAgentText
} from './workflow-attempt-raw-response'
import { readWorkflowResultReport } from './workflow-completion-collector'
import { parseWorkflowCompletionJsonText } from './workflow-completion-json-parse'
import { WorkflowError } from './workflow-error'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('Workflow completion malformed JSON diagnostics', () => {
  it('preserves malformed report body without leaking it through inspect/console.warn', async () => {
    const directory = join(tmpdir(), `orca-workflow-report-${randomUUID()}`)
    cleanupPaths.push(directory)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const reportPath = join(directory, 'step.json')
    const marker = 'SECRET_RAW_REPORT_BODY_MARKER'
    const raw = `{ "schema": "${marker}", "decision":`
    await writeFile(reportPath, raw, { mode: 0o600 })

    try {
      await readWorkflowResultReport({
        reportedPath: reportPath,
        expectedReportPath: reportPath,
        run: { id: 'run-a' } as WorkflowRunRecord,
        step: { id: 'step-a', nodeType: 'decide' } as WorkflowStepRunRecord
      })
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowError)
      expect((error as WorkflowError).message).toMatch(/invalid JSON/)
      expect(takeWorkflowRawAgentText(error)).toBe(raw)
      assertLogSafe(error, marker)
    }
  })

  it('preserves malformed transcript JSON without leaking fragments via cause', () => {
    const marker = 'SECRET_RAW_TRANSCRIPT_MARKER'
    const raw = `${marker} is not valid JSON at all`
    try {
      parseWorkflowCompletionJsonText(raw, 'The final Assistant message is not exact JSON.')
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowError)
      expect((error as WorkflowError).message).toMatch(/not exact JSON/)
      expect(takeWorkflowRawAgentText(error)).toBe(raw)
      expect(failureDiagnosticFromError(error)?.rawAgentText).toBe(raw)
      assertLogSafe(error, marker)
    }
  })
})

function assertLogSafe(error: unknown, marker: string): void {
  const data = (error as WorkflowError).data
  expect(data && typeof data === 'object' ? 'cause' in data : false).toBe(false)
  expect(inspect(error, { depth: 8, showHidden: true, getters: true })).not.toContain(marker)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  console.warn('[workflow] Agent status hook failed', error)
  const printed = warn.mock.calls
    .map((call) => call.map((arg) => inspect(arg)).join(' '))
    .join('\n')
  expect(printed).not.toContain(marker)
  warn.mockRestore()
}
