import type { EntityKind, SyncOperation } from '@devdesk/shared'

/** Local persistence the engine drives. The desktop app backs this with Dexie. */
export interface SyncStore {
  getPendingOps(): Promise<SyncOperation[]>
  removePendingOps(ids: string[]): Promise<void>
  applyRemote(kind: EntityKind, record: Record<string, unknown>): Promise<void>
  getCursor(): Promise<string>
  setCursor(cursor: string): Promise<void>
}

/** The server side the engine talks to (satisfied by ApiClient). */
export interface SyncTransport {
  push(ops: SyncOperation[]): Promise<{ acked: string[]; applied: { kind: EntityKind; record: Record<string, unknown> }[] }>
  pull(cursor: string): Promise<{ cursor: string; changes: { kind: EntityKind; record: Record<string, unknown> }[] }>
  ack(cursor: string): Promise<unknown>
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 300): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i)) // exponential backoff
    }
  }
  throw lastErr
}

/**
 * Local-first sync: push queued local mutations, then pull remote changes and merge
 * them (repositories apply last-write-wins). One in-flight run at a time.
 */
export class SyncEngine {
  private running = false

  constructor(
    private readonly store: SyncStore,
    private readonly transport: SyncTransport,
  ) {}

  async sync(): Promise<{ pushed: number; pulled: number }> {
    if (this.running) return { pushed: 0, pulled: 0 }
    this.running = true
    try {
      const pushed = await this.push()
      const pulled = await this.pull()
      return { pushed, pulled }
    } finally {
      this.running = false
    }
  }

  private async push(): Promise<number> {
    const pending = await this.store.getPendingOps()
    if (!pending.length) return 0
    const result = await retry(() => this.transport.push(pending))
    for (const { kind, record } of result.applied) await this.store.applyRemote(kind, record)
    await this.store.removePendingOps(result.acked)
    return result.acked.length
  }

  private async pull(): Promise<number> {
    const cursor = await this.store.getCursor()
    const result = await retry(() => this.transport.pull(cursor))
    for (const { kind, record } of result.changes) await this.store.applyRemote(kind, record)
    if (result.cursor && result.cursor !== cursor) {
      await this.store.setCursor(result.cursor)
      await this.transport.ack(result.cursor).catch(() => {}) // ack is advisory
    }
    return result.changes.length
  }
}
