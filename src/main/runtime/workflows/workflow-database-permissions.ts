import { chmodSync, existsSync } from 'node:fs'

export function hardenWorkflowDatabaseFiles(path: string | ':memory:'): void {
  if (path === ':memory:' || process.platform === 'win32') {
    return
  }
  for (const databasePath of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(databasePath)) {
      chmodSync(databasePath, 0o600)
    }
  }
}
