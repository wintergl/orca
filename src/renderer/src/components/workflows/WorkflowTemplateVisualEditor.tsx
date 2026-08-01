import { useMemo, useState } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'
import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { workflowDefinitionV1Schema } from '../../../../shared/workflow-definition-schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import { WorkflowDefinitionCanvas } from './WorkflowDefinitionCanvas'
import { WorkflowNodeConfigurationPanel } from './WorkflowNodeConfigurationPanel'
import {
  addWorkflowNode,
  moveWorkflowNode,
  removeWorkflowNode,
  type WorkflowNodeType
} from './workflow-definition-editing'

const NODE_TYPES: WorkflowNodeType[] = ['produce', 'review', 'decide', 'human-gate']

export function WorkflowTemplateVisualEditor({
  definition,
  readOnly,
  onChange
}: {
  definition: WorkflowDefinitionV1
  readOnly: boolean
  onChange: (definition: WorkflowDefinitionV1) => void
}): React.JSX.Element {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(definition.entryNodeId)
  const [newNodeType, setNewNodeType] = useState<WorkflowNodeType>('produce')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const selectedNode =
    definition.nodes.find((node) => node.id === selectedNodeId) ??
    definition.nodes.find((node) => node.id === definition.entryNodeId) ??
    definition.nodes[0] ??
    null
  const validation = useMemo(() => workflowDefinitionV1Schema.safeParse(definition), [definition])

  const addNode = (): void => {
    const result = addWorkflowNode(definition, newNodeType)
    onChange(result.definition)
    setSelectedNodeId(result.nodeId)
  }
  const removeNode = (nodeId: string): void => {
    onChange(removeWorkflowNode(definition, nodeId))
    setSelectedNodeId(definition.entryNodeId)
  }

  return (
    <section
      data-workflow-template-editor="true"
      className="grid h-full min-h-0 w-full min-w-0 overflow-hidden bg-card xl:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]"
    >
      <WorkflowDefinitionCanvas
        definition={definition}
        selectedNodeId={selectedNode?.id ?? null}
        readOnly={readOnly}
        onSelectNode={setSelectedNodeId}
        onMoveNode={(nodeId, offset) => onChange(moveWorkflowNode(definition, nodeId, offset))}
        onRemoveNode={removeNode}
        toolbarActions={
          <>
            {selectedNode ? (
              <Button
                size="icon-xs"
                variant="ghost"
                className="xl:!hidden"
                aria-label={translate('workflows.visual.openInspector', 'Open node settings')}
                onClick={() => setInspectorOpen(true)}
              >
                <SlidersHorizontal />
              </Button>
            ) : null}
            {!readOnly ? (
              <>
                <Select
                  value={newNodeType}
                  onValueChange={(value) => setNewNodeType(value as WorkflowNodeType)}
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NODE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {nodeTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="xs" variant="outline" onClick={addNode}>
                  <Plus />
                  {translate('workflows.visual.addStep', 'Add step')}
                </Button>
              </>
            ) : null}
            <Badge variant={validation.success ? 'outline' : 'destructive'}>
              {validation.success
                ? translate('workflows.visual.valid', 'Valid')
                : translate('workflows.visual.needsAttention', '{{value0}} issues', {
                    value0: validation.error.issues.length
                  })}
            </Badge>
          </>
        }
      />
      {selectedNode ? (
        <>
          <div className="min-h-0 border-l border-border max-xl:hidden">
            <WorkflowNodeConfigurationPanel
              key={selectedNode.id}
              definition={definition}
              node={selectedNode}
              readOnly={readOnly}
              onChange={onChange}
            />
          </div>
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetContent
              side="right"
              className="w-[min(92vw,30rem)] overflow-hidden p-0 xl:!hidden"
            >
              <SheetTitle className="sr-only">
                {translate('workflows.visual.nodeSettings', 'Node settings')}
              </SheetTitle>
              <WorkflowNodeConfigurationPanel
                key={`sheet:${selectedNode.id}`}
                definition={definition}
                node={selectedNode}
                readOnly={readOnly}
                onChange={onChange}
              />
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </section>
  )
}

function nodeTypeLabel(type: WorkflowNodeType): string {
  switch (type) {
    case 'produce':
      return translate('workflows.visual.agentStep', 'Agent step')
    case 'review':
      return translate('workflows.visual.parallelAgentStep', 'Parallel Agent step')
    case 'decide':
      return translate('workflows.visual.binaryDecision', 'Binary decision')
    case 'human-gate':
      return translate('workflows.visual.humanStep', 'Human confirmation')
    case 'complete':
      return translate('workflows.visual.endStep', 'End')
  }
}
