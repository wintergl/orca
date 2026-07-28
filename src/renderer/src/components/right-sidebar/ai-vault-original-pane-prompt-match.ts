import type { AiVaultSession } from '../../../../shared/ai-vault-types'

function normalizeMatchText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? ''
}

function textMatchesSessionPrompt(sessionText: string, candidateText: string): boolean {
  if (!sessionText || !candidateText) {
    return false
  }
  if (sessionText === candidateText) {
    return true
  }
  return (
    sessionText.length >= 24 &&
    candidateText.length >= 24 &&
    (sessionText.startsWith(candidateText) || candidateText.startsWith(sessionText))
  )
}

function sessionPromptCandidates(session: AiVaultSession): string[] {
  const candidates = new Set<string>()
  const title = normalizeMatchText(session.title)
  if (title) {
    candidates.add(title)
  }
  for (const message of session.previewMessages) {
    if (message.role === 'user') {
      const text = normalizeMatchText(message.text)
      if (text) {
        candidates.add(text)
      }
    }
  }
  return [...candidates]
}

function entryPromptCandidates(entry: {
  prompt?: string
  stateHistory?: readonly { prompt: string }[]
}): string[] {
  const candidates = new Set<string>()
  const prompt = normalizeMatchText(entry.prompt)
  if (prompt) {
    candidates.add(prompt)
  }
  for (const historyEntry of entry.stateHistory ?? []) {
    const text = normalizeMatchText(historyEntry.prompt)
    if (text) {
      candidates.add(text)
    }
  }
  return [...candidates]
}

export function promptsMatchSession(
  session: AiVaultSession,
  entry: Parameters<typeof entryPromptCandidates>[0]
): boolean {
  const sessionCandidates = sessionPromptCandidates(session)
  if (sessionCandidates.length === 0) {
    return false
  }
  const entryCandidates = entryPromptCandidates(entry)
  return sessionCandidates.some((sessionText) =>
    entryCandidates.some((entryText) => textMatchesSessionPrompt(sessionText, entryText))
  )
}
