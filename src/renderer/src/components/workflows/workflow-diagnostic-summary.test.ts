import { describe, expect, it } from 'vitest'
import type {
  WorkflowEventRecord,
  WorkflowRunRecord
} from '../../../../shared/workflow-definition-types'
import { buildWorkflowDiagnosticSummary } from './workflow-diagnostic-summary'

describe('workflow diagnostic summary', () => {
  it('keeps correlation keys while excluding prompt and conclusion bodies', () => {
    const run = {
      id: 'run-1',
      rootRunId: 'run-root',
      parentRunId: null,
      status: 'failed',
      version: 3,
      templateId: 'template-1',
      templateVersion: 2,
      templateSnapshot: { schemaVersion: 2, decisionProtocolVersion: 'v2-binary-zh' },
      executionHostId: 'local',
      workspace: { kind: 'folder-workspace', id: 'folder-a' },
      waitingReason: null,
      failureCode: 'workflow_completion_incomplete',
      lineageCycleBase: 0,
      steps: [
        {
          id: 'step-1',
          nodeId: 'agent-1',
          nodeType: 'produce',
          round: 1,
          attempt: 2,
          status: 'failed',
          taskId: 'task-1',
          dispatchId: 'dispatch-1',
          assignment: { agentLifecycleId: 'agent-1' },
          prompt: 'SECRET_PROMPT',
          conclusionMarkdown: 'SECRET_CONCLUSION',
          errorCode: 'workflow_completion_incomplete'
        }
      ]
    } as unknown as WorkflowRunRecord
    const events = [
      {
        sequence: 5,
        type: 'step-retried',
        stepRunId: 'step-1',
        payload: { routeId: 'route-a', secret: 'SECRET_EVENT' }
      }
    ] as WorkflowEventRecord[]
    const summary = buildWorkflowDiagnosticSummary(run, events)
    expect(summary).toContain('dispatch-1')
    expect(summary).toContain('route-a')
    expect(summary).not.toContain('SECRET_')
  })
})
