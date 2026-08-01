/** P0 canonical V1 decision protocol shared by prompts, parsers, and preflight. */

export const WORKFLOW_DECISION_PROTOCOL_VERSION_V1 = 'v1-approve-revise' as const
export const WORKFLOW_DECISION_PROTOCOL_VERSION_V2 = 'v2-binary-zh' as const

export type WorkflowDecisionProtocolVersion =
  | typeof WORKFLOW_DECISION_PROTOCOL_VERSION_V1
  | typeof WORKFLOW_DECISION_PROTOCOL_VERSION_V2

export type WorkflowReviewVerdictToken = 'approve' | 'revise' | 'request-human'
export type WorkflowDecisionToken = WorkflowReviewVerdictToken | 'stop-at-review'

export const WORKFLOW_REVIEW_VERDICT_TOKENS = [
  'approve',
  'revise',
  'request-human'
] as const satisfies readonly WorkflowReviewVerdictToken[]

export const WORKFLOW_DECISION_TOKENS = [
  'approve',
  'revise',
  'request-human',
  'stop-at-review'
] as const satisfies readonly WorkflowDecisionToken[]

/** Chinese aliases for unversioned / legacy V1 templates only. */
const REVIEW_ALIASES: Record<WorkflowReviewVerdictToken, readonly string[]> = {
  approve: ['通过', '批准'],
  revise: ['需要修改', '需要修订', '不通过', '退回修改'],
  'request-human': ['请求人工', '人工处理', '人工确认']
}

const DECISION_ONLY_ALIASES: Record<'stop-at-review', readonly string[]> = {
  'stop-at-review': ['停在评审', '止于评审']
}

/** V1 forbids the V2 binary protocol as aliases. */
const FORBIDDEN_V1_BINARY_TOKENS = ['完成', '不完成'] as const

export function workflowDecisionProtocolInstruction(kind: 'review' | 'decision'): string {
  const tokens =
    kind === 'review'
      ? WORKFLOW_REVIEW_VERDICT_TOKENS.join('、')
      : WORKFLOW_DECISION_TOKENS.join('、')
  return `请在结论第一行明确标注 ${tokens}（仅使用英文 token，不要使用“完成/不完成”）。`
}

export function parseWorkflowReviewVerdict(
  value: string,
  options?: { allowAliases?: boolean }
): WorkflowReviewVerdictToken {
  const token = parseExplicitWorkflowDecision(value, {
    allowAliases: options?.allowAliases ?? true,
    allowStopAtReview: false
  })
  if (token === 'approve' || token === 'revise' || token === 'request-human') {
    return token
  }
  throw new Error('The Review conclusion must begin with approve, revise, or request-human.')
}

export function parseWorkflowDecisionToken(
  value: string,
  options?: { allowAliases?: boolean }
): WorkflowDecisionToken {
  const token = parseExplicitWorkflowDecision(value, {
    allowAliases: options?.allowAliases ?? true,
    allowStopAtReview: true
  })
  if (token) {
    return token
  }
  throw new Error(
    'The Decision conclusion must begin with approve, revise, request-human, or stop-at-review.'
  )
}

export function parseExplicitWorkflowDecision(
  value: string,
  options: { allowAliases: boolean; allowStopAtReview: boolean }
): WorkflowDecisionToken | null {
  // Why: scan at most a few heading/verdict lines; never join body text so
  // "approve\n已完成…" stays valid while a first-line “完成” still fails.
  const verdictLines = stripLeadingSystemReminders(value)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replaceAll('**', '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => line.toLowerCase())
  if (verdictLines.length === 0) {
    return null
  }
  const firstLabeled = verdictPortion(verdictLines[0]!)
  if (firstLabeled && isForbiddenV1BinaryVerdict(firstLabeled)) {
    return null
  }
  for (const line of verdictLines) {
    const labeled = verdictPortion(line)
    if (!labeled) {
      continue
    }
    const token = matchWorkflowDecisionToken(labeled, options)
    if (token) {
      return token
    }
  }
  return null
}

function verdictPortion(line: string): string | null {
  return /^(?:(?:裁定|结论|判定|verdict|decision)\s*[:：-]?\s*)?(.+)$/.exec(line)?.[1] ?? null
}

function isForbiddenV1BinaryVerdict(labeled: string): boolean {
  const compact = labeled.replace(/[。.！!？?\s]+$/g, '').trim()
  return FORBIDDEN_V1_BINARY_TOKENS.some(
    (token) =>
      compact === token ||
      compact.startsWith(`${token} `) ||
      compact.startsWith(`${token}：`) ||
      compact.startsWith(`${token}:`)
  )
}

function matchWorkflowDecisionToken(
  labeled: string,
  options: { allowAliases: boolean; allowStopAtReview: boolean }
): WorkflowDecisionToken | null {
  if (/\brequest-human\b/.test(labeled)) {
    return 'request-human'
  }
  if (options.allowStopAtReview && /\bstop-at-review\b/.test(labeled)) {
    return 'stop-at-review'
  }
  if (/\brevise\b/.test(labeled)) {
    return 'revise'
  }
  if (/\bapprove\b/.test(labeled)) {
    return 'approve'
  }
  if (!options.allowAliases) {
    return null
  }
  if (matchesAlias(labeled, REVIEW_ALIASES['request-human'])) {
    return 'request-human'
  }
  if (options.allowStopAtReview && matchesAlias(labeled, DECISION_ONLY_ALIASES['stop-at-review'])) {
    return 'stop-at-review'
  }
  if (matchesAlias(labeled, REVIEW_ALIASES.revise)) {
    return 'revise'
  }
  if (matchesAlias(labeled, REVIEW_ALIASES.approve)) {
    return 'approve'
  }
  return null
}

function matchesAlias(labeled: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => labeled.includes(alias.toLowerCase()))
}

function stripLeadingSystemReminders(value: string): string {
  let remaining = value.trimStart()
  const opening = '<system-reminder>'
  const closing = '</system-reminder>'
  while (remaining.startsWith(opening)) {
    const end = remaining.indexOf(closing, opening.length)
    if (end < 0) {
      return ''
    }
    remaining = remaining.slice(end + closing.length).trimStart()
  }
  return remaining
}
