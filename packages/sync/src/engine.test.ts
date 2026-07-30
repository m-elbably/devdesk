import { describe, it, expect, vi } from 'vitest'
import type { SyncOperation } from '@devdesk/shared'
import { SyncEngine, type SyncStore, type SyncTransport } from './engine'

function makeStore(pending: SyncOperation[]): SyncStore & { applied: Record<string, unknown>[]; cursor: string } {
  const state = { applied: [] as Record<string, unknown>[], cursor: '' }
  return {
    ...state,
    getPendingOps: async () => pending,
    removePendingOps: async (ids) => {
      for (const id of ids) {
        const i = pending.findIndex((p) => p.id === id)
        if (i >= 0) pending.splice(i, 1)
      }
    },
    applyRemote: async (_kind, record) => {
      state.applied.push(record)
    },
    getCursor: async () => state.cursor,
    setCursor: async (c) => {
      state.cursor = c
    },
  }
}

const op = (id: string): SyncOperation => ({
  id,
  kind: 'task',
  entityId: id,
  op: 'upsert',
  payload: { id, title: 'x' },
  createdAt: '2020-01-01T00:00:00.000Z',
  attempts: 0,
})

describe('SyncEngine', () => {
  it('pushes pending ops, clears the queue, and merges pulled changes', async () => {
    const store = makeStore([op('a')])
    const transport: SyncTransport = {
      push: async (ops) => ({ acked: ops.map((o) => o.id), applied: [] }),
      pull: async () => ({ cursor: '2021-01-01T00:00:00.000Z', changes: [{ kind: 'note', record: { id: 'n1' } }] }),
      ack: async () => ({ ok: true }),
    }
    const result = await new SyncEngine(store, transport).sync()
    expect(result).toEqual({ pushed: 1, pulled: 1 })
    expect(await store.getPendingOps()).toHaveLength(0)
    expect(store.applied).toContainEqual({ id: 'n1' })
    expect(await store.getCursor()).toBe('2021-01-01T00:00:00.000Z')
  })

  it('retries a failing push with backoff before succeeding', async () => {
    vi.useFakeTimers()
    const store = makeStore([op('a')])
    let calls = 0
    const transport: SyncTransport = {
      push: async () => {
        if (++calls < 2) throw new Error('network')
        return { acked: ['a'], applied: [] }
      },
      pull: async () => ({ cursor: '', changes: [] }),
      ack: async () => ({}),
    }
    const promise = new SyncEngine(store, transport).sync()
    await vi.runAllTimersAsync()
    await promise
    expect(calls).toBe(2)
    vi.useRealTimers()
  })
})
