import { parseExecutionHostId } from '../../../shared/execution-host'
import type { OrcaRuntimeService } from '../orca-runtime'

export async function isWorkflowWorkspaceAvailable(
  runtime: OrcaRuntimeService,
  workspaceId: string
): Promise<boolean> {
  try {
    const workspace = await runtime.showManagedWorktree(`id:${workspaceId}`)
    return workspace.id === workspaceId
  } catch {
    return false
  }
}

export function isWorkflowHostCapabilityAvailable(executionHostId: string): boolean {
  const host = parseExecutionHostId(executionHostId)
  return host?.kind === 'local' || host?.kind === 'runtime'
}
