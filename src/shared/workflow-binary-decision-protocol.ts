/** V2 frozen binary decision protocol: first non-empty line is 完成 or 不完成. */

export type WorkflowBinaryDecision = true | false

export function workflowBinaryProtocolInstruction(): string {
  return '请在结论第一行且只能输出“完成”或“不完成”，随后可说明理由。'
}

export function parseWorkflowBinaryDecision(value: string): WorkflowBinaryDecision {
  const first = stripLeadingSystemReminders(value)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!first) {
    throw new Error('The Decision conclusion must begin with 完成 or 不完成.')
  }
  const compact = first.replace(/[。.！!？?\s]+$/g, '').trim()
  if (compact === '完成') {
    return true
  }
  if (compact === '不完成') {
    return false
  }
  throw new Error('The Decision conclusion must begin with 完成 or 不完成.')
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
