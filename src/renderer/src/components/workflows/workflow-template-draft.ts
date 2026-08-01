import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { translate } from '@/i18n/i18n'

export function createBlankWorkflowDefinition(): WorkflowDefinitionV1 {
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
