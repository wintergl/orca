import type { TuiAgent } from './types'
import type { TuiAgentConfig } from './tui-agent-config'

export const LOCAL_PROVIDER_TUI_AGENT_CONFIG = {
  grok: {
    detectCmd: 'grok',
    launchCmd: 'grok',
    expectedProcess: 'grok',
    // Why: argv (grok takes a positional prompt) so multi-line/special-char text isn't mangled as raw PTY keystrokes.
    promptInjectionMode: 'argv',
    // Why: separator so prompts like `help`/`--version` aren't parsed as Grok CLI syntax.
    argvPromptSeparator: '--'
  },
  devin: {
    detectCmd: 'devin',
    launchCmd: 'devin',
    expectedProcess: 'devin',
    // Why: `devin -- <prompt>` auto-submits immediately (docs.devin.ai/cli), so start the REPL with no argv prompt.
    promptInjectionMode: 'stdin-after-start'
  },
  // Why: these six entries back user-installed PATH scripts (~/.local/bin/cc-*
  // and codexdb*) that wrap claude/codex with a provider env or --profile.
  // expectedProcess stays the underlying agent so PTY/process recognition,
  // status hooks, and tab titles keep working exactly like a native launch.
  'cc-mn': {
    detectCmd: 'cc-mn',
    launchCmd: 'cc-mn',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    // Why: claude's `--prefill <text>` seeds the TUI input without submitting,
    // so the draft-launch flow reuses the claude code path verbatim.
    draftPromptFlag: '--prefill'
  },
  'cc-db': {
    detectCmd: 'cc-db',
    launchCmd: 'cc-db',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  },
  'cc-zp': {
    detectCmd: 'cc-zp',
    launchCmd: 'cc-zp',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  },
  'cc-ali': {
    detectCmd: 'cc-ali',
    launchCmd: 'cc-ali',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  },
  codexdb: {
    detectCmd: 'codexdb',
    detectRequiredCommands: ['codex'],
    // Why: the local codexdb wrapper resets CODEX_HOME; launch Codex directly so Orca-managed hooks stay active.
    launchCmd: 'codex --profile doubao-coding',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv',
    preflightTrust: 'codex',
    draftPasteReadySignal: 'codex-composer-prompt'
  },
  codexdba: {
    detectCmd: 'codexdba',
    detectRequiredCommands: ['codex'],
    // Why: the local codexdba wrapper resets CODEX_HOME; launch Codex directly so Orca-managed hooks stay active.
    launchCmd: 'codex --profile doubao-agent',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv',
    preflightTrust: 'codex',
    draftPasteReadySignal: 'codex-composer-prompt'
  }
} as const satisfies Partial<Record<TuiAgent, TuiAgentConfig>>
