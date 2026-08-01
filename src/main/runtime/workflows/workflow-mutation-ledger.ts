import { createHash } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import { WorkflowError } from './workflow-error'

export type WorkflowMutation = {
  callerIdentity: string
  requestId: string
  method: string
  payload: unknown
}

type MutationRow = {
  method: string
  payload_hash: string
  state: 'pending' | 'completed'
  receipt: string | null
}

export function runWorkflowMutation<T>(
  db: Database.Database,
  mutation: WorkflowMutation,
  operation: () => T
): T {
  const payloadHash = mutationHash(mutation.method, mutation.payload)
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db
      .prepare(
        `SELECT method, payload_hash, state, receipt FROM mutation_receipts
         WHERE caller_fingerprint = ? AND request_id = ?`
      )
      .get(mutation.callerIdentity, mutation.requestId) as MutationRow | undefined
    if (existing) {
      if (existing.method !== mutation.method || existing.payload_hash !== payloadHash) {
        throw new WorkflowError(
          'request_mismatch',
          `Mutation request ${mutation.requestId} was reused with different input.`
        )
      }
      if (existing.state === 'pending' || !existing.receipt) {
        throw new WorkflowError(
          'operation_unknown',
          `Mutation ${mutation.requestId} may have completed; inspect with the same context.`
        )
      }
      db.exec('COMMIT')
      return JSON.parse(existing.receipt) as T
    }
    db.prepare(
      `INSERT INTO mutation_receipts (
         caller_fingerprint, request_id, method, payload_hash, state
       ) VALUES (?, ?, ?, ?, 'pending')`
    ).run(mutation.callerIdentity, mutation.requestId, mutation.method, payloadHash)
    const result = operation()
    db.prepare(
      `UPDATE mutation_receipts SET state = 'completed', receipt = ?, updated_at = datetime('now')
       WHERE caller_fingerprint = ? AND request_id = ?`
    ).run(JSON.stringify(result), mutation.callerIdentity, mutation.requestId)
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mutationHash(method: string, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue({ method, payload })))
    .digest('hex')
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, canonicalValue(source[key])])
  )
}
