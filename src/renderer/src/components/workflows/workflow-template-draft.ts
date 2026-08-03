import type {
  WorkflowDefinitionV1,
  WorkflowTemplateSnapshot
} from '../../../../shared/workflow-definition-types'
import type { WorkflowDefinitionV2 } from '../../../../shared/workflow-definition-v2-types'
import { isWorkflowV2FeatureEnabled } from '../../../../shared/workflow-feature-gates'
import { translate } from '@/i18n/i18n'

/**
 * SPEC: hide/disable blank creation until V2 gate is on; blanks are always V2
 * runnable graphs (agent → end), never V1 produce-only shortcuts.
 */
export function createBlankWorkflowDefinition(
  settings?: { 'workflows.v2.enabled'?: boolean } | null
): WorkflowTemplateSnapshot {
  if (!isWorkflowV2FeatureEnabled(settings)) {
    throw new Error(
      'Blank workflows require the V2 feature gate. Clone a runnable built-in template instead.'
    )
  }
  return createBlankWorkflowDefinitionV2()
}

export function isBlankWorkflowCreationEnabled(
  settings?: { 'workflows.v2.enabled'?: boolean } | null
): boolean {
  return isWorkflowV2FeatureEnabled(settings)
}

export function createBlankWorkflowDefinitionV2(): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    decisionProtocolVersion: 'v2-binary-zh',
    entryStepId: 'agent-1',
    roleSlots: [
      {
        id: 'agent',
        label: translate('workflows.run.agent', 'Agent'),
        required: true,
        minAgents: 1,
        maxAgents: 1,
        execution: 'single',
        allowedAgentStates: ['idle']
      }
    ],
    steps: [
      {
        id: 'agent-1',
        name: translate('workflows.visual.agentStep', 'Agent step'),
        kind: 'agent',
        roleSlotIds: ['agent'],
        execution: 'single',
        prompt: {
          variants: [
            {
              when: 'always',
              template:
                '工作流目标：\n{{goal}}\n\n请完成节点 {{nodeId}} 的当前任务。\n\n完成条件：\n{{criteria}}'
            }
          ],
          completionCriteria: translate(
            'workflows.prompt.defaultCriteria',
            'Return complete final content that satisfies this workflow goal.'
          )
        },
        retryPolicy: { maxAttempts: 2, backoffMs: 1000, onExhausted: 'fail-run' },
        next: { targetStepId: 'end' }
      },
      {
        id: 'end',
        name: translate('workflows.visual.complete', 'Complete'),
        kind: 'end',
        outcome: 'succeeded'
      }
    ]
  }
}

export function createBlankWorkflowDefinitionV1(): WorkflowDefinitionV1 {
  const retryPolicy = {
    maxAttempts: 2,
    backoffMs: 1_000,
    onExhausted: 'wait-human' as const
  }
  return {
    schemaVersion: 1,
    entryNodeId: 'agent-1',
    defaults: { retryPolicy },
    roleSlots: [
      {
        id: 'agent',
        label: translate('workflows.run.agent', 'Agent'),
        required: true,
        minAgents: 1,
        maxAgents: 1,
        execution: 'single',
        allowedAgentStates: ['idle']
      }
    ],
    nodes: [
      {
        id: 'agent-1',
        name: translate('workflows.visual.agentStep', 'Agent step'),
        type: 'produce',
        roleSlotIds: ['agent'],
        promptTemplateKey: null,
        promptInstructions: null,
        promptRules: {
          rules: [
            {
              id: 'agent-1-first',
              name: translate('workflows.prompt.firstVisit', 'First visit'),
              when: 'first-visit',
              template:
                '工作流目标：\n{{goal}}\n\n请完成节点 {{nodeId}} 的当前任务。\n\n完成条件：\n{{criteria}}'
            },
            {
              id: 'agent-1-repeat',
              name: translate('workflows.prompt.repeatVisit', 'Repeat visit'),
              when: 'repeat-visit',
              template:
                '工作流目标：\n{{goal}}\n\n上一轮该节点的最终结论：\n{{ history[-1].nodes["agent-1"].output }}\n\n请继续处理节点 {{nodeId}} 的当前任务。\n\n完成条件：\n{{criteria}}'
            }
          ],
          completionCriteria: translate(
            'workflows.prompt.defaultCriteria',
            'Return complete final content that satisfies this workflow goal.'
          )
        },
        inputBindings: ['root-goal'],
        retryPolicy: { ...retryPolicy },
        artifactKind: 'code',
        outputSchema: 'workflow.completion/v1'
      },
      {
        id: 'complete',
        name: translate('workflows.visual.complete', 'Complete'),
        type: 'complete',
        roleSlotIds: [],
        promptTemplateKey: null,
        promptInstructions: null,
        inputBindings: [],
        retryPolicy: { ...retryPolicy },
        outcome: 'succeeded',
        outputSchema: null
      }
    ],
    transitions: [
      {
        id: 'agent-1-complete',
        from: 'agent-1',
        when: 'step:succeeded',
        to: 'complete'
      }
    ]
  }
}
