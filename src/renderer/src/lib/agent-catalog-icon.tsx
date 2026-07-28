import type React from 'react'
import { ClaudeIcon, DroidIcon, OpenAIIcon } from '@/components/status-bar/icons'
import type { TuiAgent } from '../../../shared/types'
import {
  isCodexRuntimeAgentType,
  isCodexWrapperAgentType
} from '../../../shared/codex-wrapper-agent'
import {
  AgentLetterIcon,
  AiderIcon,
  CopilotIcon,
  KiloIcon,
  OmpIcon,
  OpenCodeIcon,
  PiIcon
} from './agent-icon-glyphs'
import { AGENT_FAVICON_ASSETS } from './agent-favicon-assets'
import { CodexWrapperAgentIcon } from './codex-wrapper-agent-icon'
import type { AgentCatalogEntry } from './agent-catalog'

export function AgentCatalogIcon({
  agent,
  size = 14,
  catalog
}: {
  agent: TuiAgent | null | undefined
  size?: number
  catalog: readonly AgentCatalogEntry[]
}): React.JSX.Element {
  // Why: render a neutral question-mark glyph when the agent identity is not
  // yet known. Before, the caller coerced null → 'claude', which caused Codex
  // panes to briefly show the Claude icon until the first hook callback arrived.
  if (!agent) {
    return <AgentLetterIcon letter="?" size={size} />
  }
  if (agent === 'claude' || agent === 'claude-agent-teams') {
    return <ClaudeIcon size={size} />
  }
  if (isCodexWrapperAgentType(agent)) {
    return <CodexWrapperAgentIcon agent={agent} size={size} />
  }
  if (isCodexRuntimeAgentType(agent)) {
    return <OpenAIIcon size={size} />
  }
  if (agent === 'droid') {
    return <DroidIcon size={size} />
  }
  if (agent === 'pi') {
    return <PiIcon size={size} />
  }
  if (agent === 'omp') {
    return <OmpIcon size={size} />
  }
  if (agent === 'aider') {
    return <AiderIcon size={size} />
  }
  if (agent === 'kilo') {
    return <KiloIcon size={size} />
  }
  if (agent === 'copilot') {
    return <CopilotIcon size={size} />
  }
  if (agent === 'opencode') {
    return <OpenCodeIcon size={size} />
  }
  const catalogEntry = catalog.find((entry) => entry.id === agent)
  // Why: prefer the favicon bundled at build time so the icon renders without a
  // live network request — Google's favicon service is unreachable in some
  // regions and offline, which left these icons broken (#8451).
  const bundledFaviconUrl = AGENT_FAVICON_ASSETS[agent]
  // Why: one resolved src for guard + attribute so empty `iconUrl` cannot pass
  // a truthy `||` check while `??` still renders a broken `<img src="">`.
  const iconSrc = catalogEntry?.iconUrl ?? bundledFaviconUrl
  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ borderRadius: 2 }}
      />
    )
  }
  if (catalogEntry?.faviconDomain) {
    // Why: agents without a published SVG icon or bundled favicon fall back to
    // their site favicon via Google's favicon service — same source the README
    // uses for the agent badge list.
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${catalogEntry.faviconDomain}&sz=64`}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ borderRadius: 2 }}
      />
    )
  }
  return (
    <AgentLetterIcon letter={(catalogEntry?.label ?? agent).charAt(0).toUpperCase()} size={size} />
  )
}
