import { describe, expect, it } from 'vitest'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import type { WorkflowRunRecord } from '../../../shared/workflow-definition-types'
import { buildWorkflowPreflightChecks } from './workflow-preflight'

describe('Workflow M3 preflight', () => {
  it('requires actual Reviewer assignments to satisfy the shared Review Policy minimum', () => {
    const definition = structuredClone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    const review = definition.nodes.find((node) => node.type === 'review')!
    if (review.type === 'review') {
      review.reviewPolicy.minReviewers = 2
      review.reviewPolicy.timeoutMs = 1_000
      review.reviewPolicy.maxReviewRounds = 4
    }
    const run = {
      objective: 'Review the fixed Artifact.',
      templateVersion: 1,
      templateSnapshot: definition,
      assignments: [
        {
          nodeId: definition.entryNodeId,
          slotId: definition.nodes[0]!.roleSlotIds[0]!,
          agentLifecycleId: 'producer'
        },
        {
          nodeId: review.id,
          slotId: review.roleSlotIds[0]!,
          agentLifecycleId: 'reviewer-a'
        }
      ]
    } as WorkflowRunRecord

    const checks = buildWorkflowPreflightChecks(run, {
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    })

    expect(checks.find((check) => check.id === 'review-bounds')?.status).toBe('failed')
  })

  it('blocks Review/Decision business prompts that conflict with V1 protocol', () => {
    const definition = structuredClone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    const decide = definition.nodes.find((node) => node.type === 'decide')!
    decide.promptInstructions = '结论第一行只能是完成/不完成。'
    const run = {
      objective: 'Ship the SPEC.',
      templateVersion: 1,
      templateSnapshot: definition,
      assignments: []
    } as unknown as WorkflowRunRecord

    const checks = buildWorkflowPreflightChecks(run, {
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    })

    expect(checks.find((check) => check.id === 'decision-protocol')).toMatchObject({
      status: 'failed',
      message: expect.stringContaining(decide.name)
    })
  })

  it('rejects V2 decision protocol stamped onto a V1 template snapshot', () => {
    const definition = structuredClone(BUILTIN_WORKFLOW_TEMPLATES[0]!.definition)
    definition.decisionProtocolVersion = 'v2-binary-zh'
    const run = {
      objective: 'Ship the SPEC.',
      templateVersion: 1,
      templateSnapshot: definition,
      assignments: []
    } as unknown as WorkflowRunRecord

    const checks = buildWorkflowPreflightChecks(run, {
      workspaceAvailable: true,
      capabilityAvailable: true,
      unavailableAgentLifecycleIds: []
    })

    expect(checks.find((check) => check.id === 'decision-protocol')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/V1 template snapshot/)
    })
  })
})
