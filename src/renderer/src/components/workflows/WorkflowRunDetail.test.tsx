// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { WorkflowRunDetail } from './WorkflowRunDetail'

vi.mock('./workflow-runtime-client', () => ({
  listWorkflowRunEvents: vi.fn(async () => ({ runId: 'run-1', events: [] }))
}))

afterEach(cleanup)

describe('WorkflowRunDetail', () => {
  it('renders persisted prompt, conclusion, dispatch identity, and Artifact manifest', () => {
    render(
      <WorkflowRunDetail
        run={runRecord()}
        target={{ kind: 'local' }}
        selectedStepRunId="step-produce"
        onBackToSetup={vi.fn()}
        onRunUpdated={vi.fn()}
      />
    )

    expect(screen.getByText('Implement the requested change.')).toBeTruthy()
    expect(screen.getByText('Changed the implementation and tests pass.')).toBeTruthy()
    expect(screen.getByText('task-produce')).toBeTruthy()
    expect(screen.getByText('dispatch-produce')).toBeTruthy()
    expect(screen.getByText(/sha256:artifact-blob/)).toBeTruthy()
    expect(screen.getByText('Review Aggregate')).toBeTruthy()
    expect(screen.getByText(/Reviewer A conclusion/)).toBeTruthy()
  })
})

function runRecord(): WorkflowRunRecord {
  return {
    id: 'run-1',
    status: 'running',
    templateName: 'Code review',
    workspace: { kind: 'folder-workspace', id: 'folder-a' },
    executionHostId: 'local',
    currentNodeId: 'code-review',
    objective: 'Implement and review.',
    failureMessage: null,
    recovery: null,
    updatedAt: '2026-07-29T00:00:00.000Z',
    steps: [
      {
        id: 'step-produce',
        nodeId: 'code-produce',
        nodeName: 'Produce',
        nodeType: 'produce',
        round: 1,
        attempt: 1,
        status: 'succeeded',
        assignment: { agentLifecycleId: 'producer' },
        taskId: 'task-produce',
        dispatchId: 'dispatch-produce',
        deliveryId: 'delivery-produce',
        prompt: 'Implement the requested change.',
        conclusionMarkdown: 'Changed the implementation and tests pass.',
        messageSource: 'report-path',
        outputArtifactRevisionId: 'artifact-1',
        inputArtifactRevisionId: null
      }
    ],
    artifacts: [
      {
        id: 'artifact-1',
        revision: 1,
        snapshotState: 'frozen',
        digest: 'artifact-digest',
        locator: { files: ['src/result.ts'] },
        materializedPath: '/tmp/orca-workflow-artifacts/run-1/artifact-digest',
        manifest: {
          schema: 'workflow.artifact-manifest/v1',
          executionHostId: 'local',
          workspaceId: 'folder-a',
          entries: [
            {
              path: 'src/result.ts',
              kind: 'file',
              size: 10,
              digest: 'content-digest',
              blobId: 'sha256:artifact-blob'
            }
          ]
        }
      }
    ],
    reviewAggregates: [
      {
        schema: 'workflow.review-aggregate/v1',
        id: 'aggregate-1',
        reviewNodeId: 'code-review',
        round: 1,
        artifactRevisionId: 'artifact-1',
        reviewerStepRunIds: ['step-review'],
        outcome: 'approve',
        conflicts: [],
        waitingReason: null,
        content: '【Reviewer A】\nReviewer A conclusion',
        createdAt: '2026-07-29T00:00:00.000Z'
      }
    ]
  } as unknown as WorkflowRunRecord
}
