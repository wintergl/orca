import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Workflow Activity placement', () => {
  it('renders Workflow Activity immediately above Agent Activity', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/right-sidebar/AiVaultPanel.tsx'),
      'utf8'
    )
    const workflowIndex = source.indexOf('<WorkflowActivityBox />')
    const agentIndex = source.indexOf('<AiVaultAgentActivitySection', workflowIndex)
    expect(workflowIndex).toBeGreaterThan(0)
    expect(agentIndex).toBeGreaterThan(workflowIndex)
  })
})
