import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Maximize2,
  MousePointer2,
  Trash2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { WorkflowDefinitionV1 } from '../../../../shared/workflow-definition-types'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useWorkflowCanvasNavigation } from './use-workflow-canvas-navigation'
import { useWorkflowPreviewResize } from './use-workflow-preview-resize'
import { WorkflowCanvasGraph } from './WorkflowCanvasGraph'
import { WorkflowRoundPreview } from './WorkflowRoundPreview'

export function WorkflowDefinitionCanvas({
  definition,
  selectedNodeId,
  readOnly,
  toolbarActions,
  onSelectNode,
  onMoveNode,
  onRemoveNode
}: {
  definition: WorkflowDefinitionV1
  selectedNodeId: string | null
  readOnly: boolean
  toolbarActions: React.ReactNode
  onSelectNode: (nodeId: string) => void
  onMoveNode: (nodeId: string, offset: -1 | 1) => void
  onRemoveNode: (nodeId: string) => void
}): React.JSX.Element {
  const [previewOpen, setPreviewOpen] = useState(() => window.innerHeight >= 700)
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId)
  const selectedIndex = selectedNode
    ? definition.nodes.findIndex((node) => node.id === selectedNode.id)
    : -1
  const fitVersion = definition.nodes.map((node) => node.id).join(':')
  const navigation = useWorkflowCanvasNavigation(fitVersion)
  const preview = useWorkflowPreviewResize(previewOpen)

  return (
    <div
      ref={preview.containerRef}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-editor-surface"
    >
      <CanvasToolbar
        definition={definition}
        selectedNodeId={selectedNodeId}
        selectedIndex={selectedIndex}
        readOnly={readOnly}
        toolbarActions={toolbarActions}
        onMoveNode={onMoveNode}
        onRemoveNode={onRemoveNode}
        onZoomIn={navigation.zoomIn}
        onZoomOut={navigation.zoomOut}
        onFit={navigation.fitWorkflow}
      />

      <div
        ref={navigation.viewportRef}
        className={cn(
          'relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden overscroll-contain',
          navigation.panning ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onPointerDown={navigation.onPointerDown}
        onPointerMove={navigation.onPointerMove}
        onPointerUp={navigation.onPointerUp}
        onPointerCancel={navigation.onPointerUp}
        onWheel={navigation.onWheel}
      >
        <div
          className="absolute left-1/2 top-1/2 will-change-transform"
          style={{
            transform: `translate3d(${navigation.transform.x}px, ${navigation.transform.y}px, 0)`
          }}
        >
          <div
            ref={navigation.contentRef}
            className="origin-center"
            style={{
              transform: `translate(-50%, -50%) scale(${navigation.transform.scale})`
            }}
          >
            <WorkflowCanvasGraph
              definition={definition}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          </div>
        </div>
      </div>

      <Collapsible
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        className="relative flex shrink-0 flex-col overflow-hidden border-t border-border bg-background/80"
        style={{ height: preview.height }}
      >
        {previewOpen ? (
          <button
            type="button"
            role="separator"
            aria-orientation="horizontal"
            aria-valuemin={160}
            aria-valuemax={320}
            aria-valuenow={preview.height}
            aria-label={translate('workflows.visual.resizePreview', 'Resize run preview')}
            className={cn(
              'absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize touch-none outline-none focus-visible:bg-ring/40',
              preview.resizing ? 'bg-ring/40' : 'hover:bg-ring/25'
            )}
            onPointerDown={preview.onPointerDown}
            onPointerMove={preview.onPointerMove}
            onPointerUp={preview.onPointerUp}
            onPointerCancel={preview.onPointerUp}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                preview.resizeBy(16)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                preview.resizeBy(-16)
              }
            }}
          />
        ) : null}
        <CollapsibleTrigger className="flex h-10 shrink-0 items-center justify-between px-3 text-left">
          <span className="flex items-center gap-2 text-xs font-medium">
            <ChevronDown
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                previewOpen ? '' : '-rotate-90'
              )}
            />
            {translate('workflows.visual.runPreview', 'Run preview')}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {translate('workflows.prompt.roundVariable', 'Current round')} 2
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex min-h-0 flex-1 overflow-hidden border-t border-border px-3 py-3">
          <WorkflowRoundPreview definition={definition} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function CanvasToolbar({
  definition,
  selectedNodeId,
  selectedIndex,
  readOnly,
  toolbarActions,
  onMoveNode,
  onRemoveNode,
  onZoomIn,
  onZoomOut,
  onFit
}: {
  definition: WorkflowDefinitionV1
  selectedNodeId: string | null
  selectedIndex: number
  readOnly: boolean
  toolbarActions: React.ReactNode
  onMoveNode: (nodeId: string, offset: -1 | 1) => void
  onRemoveNode: (nodeId: string) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}): React.JSX.Element {
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId)
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border px-3">
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="secondary"
          aria-label={translate('workflows.visual.canvasSelect', 'Select')}
        >
          <MousePointer2 />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={translate('workflows.visual.zoomIn', 'Zoom in')}
          onClick={onZoomIn}
        >
          <ZoomIn />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={translate('workflows.visual.zoomOut', 'Zoom out')}
          onClick={onZoomOut}
        >
          <ZoomOut />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={translate('workflows.visual.fitWorkflow', 'Fit workflow')}
          onClick={onFit}
        >
          <Maximize2 />
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {!readOnly && selectedNode ? (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={selectedIndex <= 0 || selectedNode.id === definition.entryNodeId}
              aria-label={translate('workflows.visual.moveEarlier', 'Move step earlier')}
              onClick={() => onMoveNode(selectedNode.id, -1)}
            >
              <ArrowLeft />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={
                selectedIndex < 0 ||
                selectedIndex >= definition.nodes.length - 2 ||
                selectedNode.type === 'complete'
              }
              aria-label={translate('workflows.visual.moveLater', 'Move step later')}
              onClick={() => onMoveNode(selectedNode.id, 1)}
            >
              <ArrowRight />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={
                selectedNode.id === definition.entryNodeId || selectedNode.type === 'complete'
              }
              aria-label={translate('workflows.visual.deleteNode', 'Delete step')}
              onClick={() => onRemoveNode(selectedNode.id)}
            >
              <Trash2 />
            </Button>
          </>
        ) : null}
        {toolbarActions}
      </div>
    </div>
  )
}
