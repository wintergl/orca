import { workflowIncompleteWithRawAgentText } from './workflow-attempt-raw-response'

/** Parse Agent/report JSON; preserve raw body on the incomplete diagnostic channel. */
export function parseWorkflowCompletionJsonText(text: string, invalidMessage: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Why: do not attach SyntaxError as cause — Node embeds input fragments in its message.
    throw workflowIncompleteWithRawAgentText(invalidMessage, text)
  }
}
