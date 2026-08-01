import { describe, expect, it } from 'vitest'
import type {
  WorkflowArtifactRevision,
  WorkflowRunRecord,
  WorkflowStepRunRecord
} from '../../../shared/workflow-definition-types'
import { getBuiltinWorkflowTemplate } from '../../../shared/workflow-fixtures'
import { renderWorkflowNodeInstructions } from './workflow-prompt-context'

describe('Workflow node prompt context', () => {
  it('renders the root goal, upstream conclusion, and frozen Artifact for Review', () => {
    const template = structuredClone(getBuiltinWorkflowTemplate('builtin.spec-review.v1')!)
    const producer = step({
      id: 'produce-step',
      nodeId: 'spec-produce',
      nodeName: 'SPEC 编写',
      nodeType: 'produce',
      conclusionMarkdown: 'SPEC 已完成并保存。'
    })
    const review = step({
      id: 'review-step',
      nodeId: 'spec-review',
      nodeName: 'SPEC 评审',
      nodeType: 'review',
      inputArtifactRevisionId: 'artifact-1'
    })
    const artifact = {
      id: 'artifact-1',
      kind: 'spec',
      revision: 1,
      executionHostId: 'local',
      worktreeId: 'worktree-a',
      locator: { paths: ['docs/spec/example.md'] },
      digest: 'sha256:artifact',
      manifestDigest: 'sha256:manifest',
      manifest: {
        schema: 'workflow.artifact-manifest/v1',
        executionHostId: 'local',
        workspaceId: 'worktree-a',
        entries: []
      },
      snapshotState: 'frozen',
      producedByStepRunId: producer.id,
      materializedPath: '/tmp/frozen-spec',
      createdAt: '2026-07-31T00:00:00Z'
    } satisfies WorkflowArtifactRevision
    const run = {
      templateName: template.name,
      templateVersion: template.version,
      templateSnapshot: template.definition,
      objective: '完善工作流提示词传递。',
      steps: [producer, review],
      artifacts: [artifact],
      reviewAggregates: [],
      decisions: []
    } as unknown as WorkflowRunRecord

    const rendered = renderWorkflowNodeInstructions(run, review)

    expect(rendered).toContain('当前工作目标为：\n完善工作流提示词传递。')
    expect(rendered).toContain('SPEC 已完成并保存。')
    expect(rendered).toContain('Artifact Revision: artifact-1')
    expect(rendered).toContain('Immutable snapshot: /tmp/frozen-spec')
    expect(rendered).not.toContain('{{')
  })

  it('passes a long upstream conclusion without truncating the next Step context', () => {
    const template = structuredClone(getBuiltinWorkflowTemplate('builtin.spec-review.v1')!)
    const conclusion = `${'完整的上游结论。'.repeat(150_000)}END-OF-CONCLUSION`
    const producer = step({
      id: 'produce-long',
      nodeId: 'spec-produce',
      nodeName: 'SPEC 编写',
      nodeType: 'produce',
      conclusionMarkdown: conclusion
    })
    const review = step({
      id: 'review-long',
      nodeId: 'spec-review',
      nodeName: 'SPEC 评审',
      nodeType: 'review',
      inputArtifactRevisionId: 'artifact-long'
    })
    const artifact = {
      id: 'artifact-long',
      kind: 'spec',
      revision: 1,
      executionHostId: 'local',
      worktreeId: 'worktree-a',
      locator: { paths: ['docs/spec/large.md'] },
      digest: 'sha256:large-artifact',
      manifestDigest: 'sha256:large-manifest',
      manifest: {
        schema: 'workflow.artifact-manifest/v1',
        executionHostId: 'local',
        workspaceId: 'worktree-a',
        entries: []
      },
      snapshotState: 'frozen',
      producedByStepRunId: producer.id,
      materializedPath: '/tmp/frozen-large-spec',
      createdAt: '2026-07-31T00:00:00Z'
    } satisfies WorkflowArtifactRevision
    const run = {
      templateName: template.name,
      templateVersion: template.version,
      templateSnapshot: template.definition,
      objective: '验证长内容交接。',
      steps: [producer, review],
      artifacts: [artifact],
      reviewAggregates: [],
      decisions: []
    } as unknown as WorkflowRunRecord

    const rendered = renderWorkflowNodeInstructions(run, review)
    const conclusionOffset = rendered.indexOf(conclusion)

    expect(Buffer.byteLength(rendered)).toBeGreaterThan(2 * 1024 * 1024)
    expect(conclusionOffset).toBeGreaterThanOrEqual(0)
    expect(rendered.slice(conclusionOffset, conclusionOffset + conclusion.length)).toBe(conclusion)
  })

  it('selects the repeat rule and resolves history by round plus node ID', () => {
    const template = structuredClone(getBuiltinWorkflowTemplate('builtin.spec-review.v1')!)
    const node = template.definition.nodes.find((candidate) => candidate.id === 'spec-produce')!
    node.promptRules = {
      rules: [
        {
          id: 'first',
          name: 'First',
          when: 'first-visit',
          template: '第一版：{{goal}}\n\n{{criteria}}'
        },
        {
          id: 'repeat',
          name: 'Repeat',
          when: 'repeat-visit',
          template: '上一轮评审：{{ history[-1].nodes["spec-review"].output }}'
        }
      ],
      completionCriteria: '完整'
    }
    const previousProduce = step({
      id: 'produce-round-1',
      nodeId: 'spec-produce',
      nodeName: 'SPEC 编写',
      nodeType: 'produce',
      round: 1,
      conclusionMarkdown: '第一版'
    })
    const previousReview = step({
      id: 'review-round-1',
      nodeId: 'spec-review',
      nodeName: 'SPEC 评审',
      nodeType: 'review',
      round: 1,
      conclusionMarkdown: '需要补充异常流程。'
    })
    const current = step({
      id: 'produce-round-2',
      nodeId: 'spec-produce',
      nodeName: 'SPEC 编写',
      nodeType: 'produce',
      round: 2,
      status: 'queued'
    })
    const run = {
      templateName: template.name,
      templateVersion: template.version,
      templateSnapshot: template.definition,
      objective: '完善工作流。',
      steps: [previousProduce, previousReview, current],
      artifacts: [],
      reviewAggregates: [],
      decisions: []
    } as unknown as WorkflowRunRecord

    expect(renderWorkflowNodeInstructions(run, current)).toBe('上一轮评审：需要补充异常流程。')
  })
})

function step(
  override: Partial<WorkflowStepRunRecord> &
    Pick<WorkflowStepRunRecord, 'id' | 'nodeId' | 'nodeName' | 'nodeType'>
): WorkflowStepRunRecord {
  return {
    runId: 'run-1',
    round: 1,
    attempt: 1,
    status: 'succeeded',
    assignment: null,
    orchestrationRunId: null,
    taskId: null,
    dispatchId: null,
    deliveryId: `delivery-${override.id}`,
    deliveryState: 'delivered',
    prompt: '',
    conclusionMarkdown: null,
    resultEnvelope: null,
    messageSource: null,
    messageDigest: null,
    sourceIdentity: null,
    sourceWarnings: [],
    inputArtifactRevisionId: null,
    outputArtifactRevisionId: null,
    errorCode: null,
    errorMessage: null,
    recovery: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
    ...override
  }
}
