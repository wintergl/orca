import { describe, expect, it } from 'vitest'
import type {
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { normalizeWorkflowResult } from './workflow-result-normalization'

const run = {
  id: 'workflow-run-1',
  executionHostId: 'local',
  reviewAggregates: []
} as unknown as WorkflowRunRecord

const step = {
  id: 'workflow-step-1',
  nodeType: 'produce',
  taskId: 'task-1',
  dispatchId: 'dispatch-1',
  inputArtifactRevisionId: null,
  assignment: {
    nodeId: 'produce',
    slotId: 'producer',
    worktreeId: 'worktree-1',
    executionHostId: 'local',
    paneKey: 'pane-1',
    agentLifecycleId: 'lifecycle-1',
    providerSessionId: 'session-1',
    runtimeAgent: 'codex'
  }
} as WorkflowStepRunRecord

const compactResult = {
  schema: 'workflow.completion/v1',
  outcome: 'succeeded',
  summary: 'Implemented the requested change.',
  finalConclusionMarkdown: 'The requested change is complete.',
  artifacts: [{ kind: 'code', locator: { paths: ['src/result.ts'] } }],
  validations: [{ command: 'test', result: 'passed', evidence: 'passed' }],
  unresolved: [],
  readyForNextStep: true
} as const

describe('normalizeWorkflowResult', () => {
  it('adds trusted Workflow identity to a compact Agent result', () => {
    expect(normalizeWorkflowResult(compactResult, run, step)).toMatchObject({
      ...compactResult,
      taskId: 'task-1',
      dispatchId: 'dispatch-1',
      workflowRunId: 'workflow-run-1',
      stepRunId: 'workflow-step-1',
      agentLifecycleId: 'lifecycle-1',
      providerSessionId: 'session-1',
      executionHostId: 'local'
    })
  })

  it('keeps legacy complete envelopes strict about their supplied identity', () => {
    const expanded = normalizeWorkflowResult(compactResult, run, step)

    expect(() =>
      normalizeWorkflowResult({ ...expanded, dispatchId: 'stale-dispatch' }, run, step)
    ).toThrow('identity does not match')
  })
})
