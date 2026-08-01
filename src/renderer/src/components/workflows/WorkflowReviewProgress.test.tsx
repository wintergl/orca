// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { WorkflowReviewProgress } from './WorkflowReviewProgress'

afterEach(cleanup)

describe('WorkflowReviewProgress', () => {
  it('shows completed, waiting, and failed Reviewer states without color-only meaning', () => {
    const onOpenStep = vi.fn()
    render(<WorkflowReviewProgress run={runRecord()} onOpenStep={onOpenStep} />)

    expect(screen.getByText('Round 1 · reviewing')).toBeTruthy()
    expect(screen.getByText(/1 \/ 3 Reviewers completed/)).toBeTruthy()
    expect(screen.getByText(/1 waiting/)).toBeTruthy()
    expect(screen.getByText(/1 failed/)).toBeTruthy()
    expect(screen.getByText('succeeded')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.getByText('timed-out')).toBeTruthy()
  })
})

function runRecord(): WorkflowRunRecord {
  return {
    id: 'run-1',
    currentNodeId: 'review',
    templateSnapshot: {
      nodes: [{ id: 'review', type: 'review' }]
    },
    steps: [
      reviewer('step-a', 'reviewer-a', 'succeeded'),
      reviewer('step-b', 'reviewer-b', 'running'),
      reviewer('step-c', 'reviewer-c', 'timed-out')
    ]
  } as WorkflowRunRecord
}

function reviewer(id: string, lifecycleId: string, status: 'succeeded' | 'running' | 'timed-out') {
  return {
    id,
    nodeId: 'review',
    nodeType: 'review',
    round: 1,
    attempt: 1,
    status,
    assignment: {
      agentLifecycleId: lifecycleId,
      runtimeAgent: lifecycleId
    }
  } as WorkflowRunRecord['steps'][number]
}
