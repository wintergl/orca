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

/** Optional label for stripping headings like “判定结果” / “Verdict:”. */
const VERDICT_LABEL = /^(?:裁定|结论|判定|verdict|decision)\s*[:：-]?\s*/i
/** Explicit labeled value (requires separator) — invalid value fail-closes immediately. */
const EXPLICIT_VERDICT_LABEL = /^(?:裁定|结论|判定|verdict|decision)\s*[:：-]\s*\S/i
const DECORATIVE_PREFIX = /^(?:[✅❌✓✗✔✖•*·\-\s]|[\u{1F300}-\u{1FAFF}])+/u

export function workflowDecisionProtocolInstruction(kind: 'review' | 'decision'): string {
  const tokens =
    kind === 'review'
      ? WORKFLOW_REVIEW_VERDICT_TOKENS.join('、')
      : WORKFLOW_DECISION_TOKENS.join('、')
  return `请在结论第一行明确标注 ${tokens}（仅使用英文 token，不要使用“完成/不完成”）。`
}

/** Explicit V1 requires English tokens only; unversioned templates keep legacy aliases. */
export function workflowDecisionAllowsAliases(
  version: WorkflowDecisionProtocolVersion | null | undefined
): boolean {
  return version == null
}

export function hasWorkflowDecisionProtocolConflict(businessPrompt: string): boolean {
  const text = normalizeProtocolConflictText(businessPrompt)
  if (!text) {
    return false
  }
  // Binary first-line / first-row output constraints that fight V1 approve/revise.
  return (
    /(?:第一行|首行|结论第一行).{0,24}(?:只能是|仅允许|只能|仅能|必须为|必须是|输出必须为|输出必须是).{0,16}完成.{0,8}不完成/.test(
      text
    ) ||
    /(?:只能|仅允许|必须)(?:输出|填写|标注|写).{0,12}完成.{0,8}不完成/.test(text) ||
    /(?:第一行|首行).{0,16}完成\s*[/／]\s*不完成/.test(text)
  )
}

export function stampWorkflowDecisionProtocolVersionV1<T extends object>(
  definition: T
): Omit<T, 'decisionProtocolVersion'> & {
  decisionProtocolVersion: typeof WORKFLOW_DECISION_PROTOCOL_VERSION_V1
} {
  return {
    ...definition,
    decisionProtocolVersion: WORKFLOW_DECISION_PROTOCOL_VERSION_V1
  }
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
  // Why: walk candidate lines in order; first real verdict wins. Prose that merely
  // mentions "approve" is not a verdict; a bare “完成/不完成” fails closed immediately.
  const verdictLines = stripLeadingSystemReminders(value)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replaceAll('**', '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 6)
  for (const line of verdictLines) {
    const explicitLabeled = EXPLICIT_VERDICT_LABEL.test(line)
    const candidate = verdictCandidate(line)
    if (!candidate) {
      continue
    }
    if (isForbiddenV1BinaryVerdict(candidate)) {
      return null
    }
    const token = matchExactWorkflowDecisionToken(candidate, options)
    if (token) {
      return token
    }
    // Why: “Verdict: I cannot approve…” must not fall through to a later bare approve.
    if (explicitLabeled) {
      return null
    }
  }
  return null
}

function verdictCandidate(line: string): string | null {
  const withoutLabel = line.replace(VERDICT_LABEL, '').trim()
  if (!withoutLabel) {
    return null
  }
  // Unlabeled prose headings like "SPEC 判定结论" are not verdicts — only keep them
  // when they still look like a compact token after stripping decoration.
  const compact = stripTrailingPunctuation(withoutLabel)
  const stripped = compact.replace(DECORATIVE_PREFIX, '').trim()
  if (!stripped) {
    return null
  }
  // Reject long prose unless it was explicitly labeled as a verdict/decision line.
  const labeled = VERDICT_LABEL.test(line)
  if (!labeled && stripped.length > 32) {
    return null
  }
  return stripped
}

function isForbiddenV1BinaryVerdict(candidate: string): boolean {
  const compact = stripTrailingPunctuation(candidate)
  return FORBIDDEN_V1_BINARY_TOKENS.some(
    (token) =>
      compact === token ||
      compact.startsWith(`${token} `) ||
      compact.startsWith(`${token}：`) ||
      compact.startsWith(`${token}:`)
  )
}

function matchExactWorkflowDecisionToken(
  candidate: string,
  options: { allowAliases: boolean; allowStopAtReview: boolean }
): WorkflowDecisionToken | null {
  const compact = stripTrailingPunctuation(candidate).toLowerCase()
  if (compact === 'request-human') {
    return 'request-human'
  }
  if (options.allowStopAtReview && compact === 'stop-at-review') {
    return 'stop-at-review'
  }
  if (compact === 'revise') {
    return 'revise'
  }
  if (compact === 'approve') {
    return 'approve'
  }
  if (!options.allowAliases) {
    return null
  }
  // Aliases stay case-sensitive Chinese exact matches (not substring-in-prose).
  const original = stripTrailingPunctuation(candidate)
  if (matchesExactAlias(original, REVIEW_ALIASES['request-human'])) {
    return 'request-human'
  }
  if (
    options.allowStopAtReview &&
    matchesExactAlias(original, DECISION_ONLY_ALIASES['stop-at-review'])
  ) {
    return 'stop-at-review'
  }
  if (matchesExactAlias(original, REVIEW_ALIASES.revise)) {
    return 'revise'
  }
  if (matchesExactAlias(original, REVIEW_ALIASES.approve)) {
    return 'approve'
  }
  return null
}

function matchesExactAlias(value: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => {
    if (value === alias) {
      return true
    }
    // Why: labeled lines often use short natural suffixes (请求人工处理).
    return value.startsWith(alias) && value.length - alias.length <= 4
  })
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[。.！!？?\s]+$/g, '').trim()
}

function normalizeProtocolConflictText(value: string): string {
  return value
    .replace(/[‘’‛‹›']/g, "'")
    .replace(/[“”„«»「」『』"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
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
