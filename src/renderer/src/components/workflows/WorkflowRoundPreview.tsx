import { ArrowRight } from 'lucide-react'
import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { workflowPromptHistoryToken } from '../../../../shared/workflow-prompt-instructions'

export function WorkflowRoundPreview({
  definition
}: {
  definition: WorkflowDefinitionV1
}): React.JSX.Element {
  const nodes = definition.nodes.filter(
    (node) => node.type !== 'human-gate' && node.type !== 'complete'
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
        {nodes.map((node, index) => (
          <span key={node.id} className="flex items-center gap-2">
            <code>{node.id}</code>
            {index < nodes.length - 1 ? (
              <ArrowRight className="size-3 text-muted-foreground" />
            ) : null}
          </span>
        ))}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-border">
        <div className="grid min-w-[32rem] gap-px bg-border">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 bg-background px-3 py-2 text-[11px]"
            >
              <span className="truncate">
                {node.name} <code className="text-muted-foreground">({node.id})</code>
              </span>
              <code className="truncate text-muted-foreground">
                {workflowPromptHistoryToken(2, node.id).slice(3, -3)}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
