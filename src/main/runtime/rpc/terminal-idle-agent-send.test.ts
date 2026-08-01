import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'
import {
  RUNTIME_CAPABILITIES,
  TERMINAL_AGENT_IDLE_GUARD_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'

function stubRuntime(overrides: Partial<OrcaRuntimeService>): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'test-runtime',
    ...overrides
  } as OrcaRuntimeService
}

function request(): RpcRequest {
  return {
    id: 'req-1',
    authToken: 'tok',
    method: 'terminal.send',
    params: {
      terminal: 'terminal-1',
      text: 'hi',
      requireAgentStatus: 'idle',
      client: { id: 'desktop-1', type: 'desktop' }
    }
  }
}

describe('idle-only terminal Agent send', () => {
  it('refuses the write when the Agent started working', async () => {
    const runtime = stubRuntime({
      resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      getTerminalAgentStatus: vi.fn().mockResolvedValue({
        handle: 'terminal-1',
        isRunningAgent: true,
        status: 'working'
      }),
      sendTerminal: vi.fn()
    })

    const response = await new RpcDispatcher({ runtime, methods: TERMINAL_METHODS }).dispatch(
      request()
    )

    expect(response).toMatchObject({
      ok: true,
      result: {
        send: {
          accepted: false,
          bytesWritten: 0,
          refusedReason: 'not-idle'
        }
      }
    })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })

  it('writes while the same terminal Agent remains idle', async () => {
    const runtime = stubRuntime({
      resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      getTerminalAgentStatus: vi.fn().mockResolvedValue({
        handle: 'terminal-1',
        isRunningAgent: true,
        status: 'idle'
      }),
      sendTerminal: vi.fn().mockResolvedValue({
        handle: 'terminal-1',
        accepted: true,
        bytesWritten: 2
      })
    })

    const response = await new RpcDispatcher({ runtime, methods: TERMINAL_METHODS }).dispatch(
      request()
    )

    expect(response).toMatchObject({
      ok: true,
      result: { send: { accepted: true, bytesWritten: 2 } }
    })
  })

  it('advertises the idle guard to Runtime Host clients', () => {
    expect(RUNTIME_CAPABILITIES).toContain(TERMINAL_AGENT_IDLE_GUARD_RUNTIME_CAPABILITY)
  })
})
