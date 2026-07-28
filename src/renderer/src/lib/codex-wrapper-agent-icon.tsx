import type React from 'react'
import { OpenAIIcon } from '@/components/status-bar/icons'
import type { CodexWrapperAgent } from '../../../shared/codex-wrapper-agent'

export function CodexWrapperAgentIcon({
  agent,
  size
}: {
  agent: CodexWrapperAgent
  size: number
}): React.JSX.Element {
  const isDoubaoCoding = agent === 'codexdb'
  const rootStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(3, Math.round(size * 0.22)),
    background: isDoubaoCoding
      ? 'color-mix(in srgb, var(--sidebar-ring) 16%, var(--sidebar))'
      : 'color-mix(in srgb, var(--accent) 72%, var(--background))',
    boxShadow: isDoubaoCoding
      ? 'inset 0 0 0 1px color-mix(in srgb, var(--sidebar-ring) 42%, transparent)'
      : 'inset 0 0 0 1px color-mix(in srgb, var(--accent-foreground) 22%, transparent)'
  }
  const markSize = Math.max(8, Math.round(size * 0.72))
  const badgeSize = Math.max(4, Math.round(size * 0.38))
  const badgeStyle: React.CSSProperties = {
    width: badgeSize,
    height: badgeSize,
    right: -1,
    bottom: isDoubaoCoding ? -1 : undefined,
    top: isDoubaoCoding ? undefined : -1,
    borderRadius: isDoubaoCoding ? 1 : 999,
    background: isDoubaoCoding ? 'var(--sidebar-ring)' : 'var(--accent-foreground)',
    boxShadow: '0 0 0 1px var(--sidebar)'
  }
  return (
    <span
      data-agent-profile-icon={agent}
      aria-hidden
      style={rootStyle}
      className="relative inline-flex shrink-0 items-center justify-center text-current"
    >
      <OpenAIIcon size={markSize} />
      <span className="absolute" style={badgeStyle} />
    </span>
  )
}
