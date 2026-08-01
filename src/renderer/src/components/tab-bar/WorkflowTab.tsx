import { Workflow } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getTabRootStateClasses,
  getTabStripBorderClasses
} from './drop-indicator'
import { TAB_CONTAINER_WIDTH_CLASSES, TAB_LABEL_WIDTH_CLASSES } from './tab-width-rules'
import { useTabStripPointerActivation } from './tab-strip-pointer-activation'
import { preventMiddleButtonDefault } from './middle-button-default-guard'
import { EditorFileTabCloseButton } from './EditorFileTabCloseButton'

export function WorkflowTab({
  id,
  isActive,
  onActivate,
  onClose,
  includeTopTabBorder = true
}: {
  id: string
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  includeTopTabBorder?: boolean
}): React.JSX.Element {
  const { onPointerDown } = useTabStripPointerActivation({ onActivate })

  return (
    <div
      role="tab"
      tabIndex={0}
      data-tab-id={id}
      data-active={isActive ? 'true' : 'false'}
      aria-selected={isActive}
      className={`group relative flex h-full cursor-pointer select-none items-center px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${TAB_CONTAINER_WIDTH_CLASSES} ${getTabStripBorderClasses(false, { includeTopBorder: includeTopTabBorder })} ${getTabRootStateClasses(isActive)}`}
      onPointerDown={onPointerDown}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault()
        }
      }}
      onMouseUp={preventMiddleButtonDefault}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate()
        }
      }}
    >
      {isActive ? <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden /> : null}
      <Workflow className="mr-1.5 size-3.5 shrink-0" />
      <span className={TAB_LABEL_WIDTH_CLASSES}>
        {translate('workflows.tab.title', 'Workflows')}
      </span>
      <EditorFileTabCloseButton
        fileIsDirty={false}
        showsSelectionChrome={isActive}
        onClose={onClose}
      />
    </div>
  )
}
