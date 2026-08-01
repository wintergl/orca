import { rm } from 'node:fs/promises'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowEngine } from './workflow-engine'
import type { WorkflowStore } from './workflow-store'

const cleanupPaths: string[] = []
const stores: WorkflowStore[] = []
const orchestrationDbs: OrchestrationDb[] = []
const engines: WorkflowEngine[] = []

export const WORKFLOW_ENGINE_TEST_HANDLES: Record<string, string> = {
  'pane-producer': 'terminal-producer',
  'pane-reviewer': 'terminal-reviewer',
  'pane-reviewer-2': 'terminal-reviewer-2',
  'pane-decider': 'terminal-decider',
  'pane-spec-producer': 'terminal-spec-producer',
  'pane-spec-reviewer': 'terminal-spec-reviewer'
}

export function registerWorkflowEngineCleanupPath(path: string): void {
  cleanupPaths.push(path)
}

export function registerWorkflowEngineStore(store: WorkflowStore): void {
  stores.push(store)
}

export function registerWorkflowEngineOrchestration(db: OrchestrationDb): void {
  orchestrationDbs.push(db)
}

export function registerWorkflowEngine(engine: WorkflowEngine): void {
  engines.push(engine)
}

export async function cleanupWorkflowEngineHarnesses(): Promise<void> {
  for (const engine of engines.splice(0)) {
    engine.stop()
  }
  for (const store of stores.splice(0)) {
    store.close()
  }
  for (const db of orchestrationDbs.splice(0)) {
    db.close()
  }
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
}

export function paneKeyForHandle(handle: string): string {
  return handle.replace('terminal-', 'pane-')
}

export function lifecycleIdForHandle(handle: string): string {
  return handle.replace('terminal-', '')
}

export function providerSessionIdForHandle(handle: string, producerSessionId: string): string {
  const sessions: Record<string, string> = {
    'terminal-producer': producerSessionId,
    'terminal-spec-producer': 'session-spec-producer',
    'terminal-decider': 'session-decider',
    'terminal-spec-reviewer': 'session-spec-reviewer',
    'terminal-reviewer-2': 'session-reviewer-2',
    'terminal-reviewer': 'session-reviewer'
  }
  return sessions[handle] ?? 'session-reviewer'
}
