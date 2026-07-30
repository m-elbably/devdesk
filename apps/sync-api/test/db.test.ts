import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listSince, upsertRecords } from '../src/db'
import { parseCursor } from '../src/sync'

/**
 * The rest of the suite stubs `DB` with `{}`, so none of the sync SQL ever runs. These
 * tests execute it against a real SQLite (node:sqlite is stdlib as of Node 22.5, no new
 * dependency) behind a shim covering the slice of the D1 API `db.ts` actually uses.
 */
function makeDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8'))
  const run = (sql: string, params: unknown[]) => ({ results: sqlite.prepare(sql).all(...(params as never[])) })
  return {
    // `bind()` carries the statement for batch() and can also be awaited directly via
    // all(), which is how readData runs.
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({ sql, params, all: async () => run(sql, params) }),
    }),
    batch: async (stmts: { sql: string; params: unknown[] }[]) => stmts.map((s) => run(s.sql, s.params)),
  } as unknown as D1Database
}

const USER = 'u1'
const rec = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  workspaceId: 'w1',
  revision: 0,
  updatedAt,
  deletedAt: null,
  ...extra,
})

let DB: D1Database
beforeEach(() => {
  DB = makeDb()
})

const push = (...records: ReturnType<typeof rec>[]) =>
  upsertRecords(
    DB,
    USER,
    records.map((incoming) => ({ kind: 'task' as const, incoming })),
  )

const seqOf = async (id: string) =>
  (await listSince(DB, 'task', USER, 0)).find((r) => r.record.id === id)!.seq

describe('pull delivery ordering', () => {
  it('delivers a record stamped older than the cursor (the clock-skew bug)', async () => {
    // Device A's clock runs 3 minutes fast.
    await push(rec('skewed', '2024-01-01T00:03:00.000Z'))
    // Device B pulls it and parks its cursor at that position.
    const cursor = await seqOf('skewed')

    // Device C, with a correct clock, writes something now.
    await push(rec('normal', '2024-01-01T00:00:00.000Z'))

    // Under the old timestamp cursor this returned nothing and 'normal' was lost forever.
    const changes = await listSince(DB, 'task', USER, cursor)
    expect(changes.map((c) => c.record.id)).toEqual(['normal'])
  })

  it('assigns a distinct, increasing seq to each write in a batch', async () => {
    await push(rec('a', '2024-01-01T00:00:00.000Z'), rec('b', '2024-01-01T00:00:00.000Z'))
    const seqs = (await listSince(DB, 'task', USER, 0)).map((r) => r.seq)
    expect(seqs).toEqual([1, 2])
  })

  it('re-delivers an updated record at a new position', async () => {
    await push(rec('a', '2024-01-01T00:00:00.000Z'), rec('b', '2024-01-01T00:00:00.000Z'))
    const cursor = await seqOf('b')
    await push(rec('a', '2024-01-01T00:05:00.000Z', { title: 'edited' }))

    const changes = await listSince(DB, 'task', USER, cursor)
    expect(changes.map((c) => c.record.id)).toEqual(['a'])
    expect(changes[0]!.record.title).toBe('edited')
  })

  it('scopes seq per user, so one user cannot skip another past their records', async () => {
    await push(rec('a', '2024-01-01T00:00:00.000Z'))
    await upsertRecords(DB, 'u2', [{ kind: 'task', incoming: rec('b', '2024-01-01T00:00:00.000Z') as never }])
    expect((await listSince(DB, 'task', 'u2', 0)).map((r) => r.seq)).toEqual([1])
  })
})

describe('last-write-wins', () => {
  it('rejects a stale write, echoes the winner back, and consumes no seq', async () => {
    await push(rec('a', '2024-01-01T00:05:00.000Z', { title: 'winner' }))
    const cursor = await seqOf('a')

    const [echoed] = await push(rec('a', '2024-01-01T00:00:00.000Z', { title: 'stale' }))
    expect(echoed!.title).toBe('winner')

    // Nothing changed, so nothing needs re-delivering.
    expect(await listSince(DB, 'task', USER, cursor)).toHaveLength(0)
  })

  it('accepts a newer write and bumps revision', async () => {
    await push(rec('a', '2024-01-01T00:00:00.000Z', { title: 'first' }))
    const [stored] = await push(rec('a', '2024-01-01T00:05:00.000Z', { title: 'second' }))
    expect(stored!.title).toBe('second')
    expect(stored!.revision).toBe(1)
  })

  it('keeps a tombstone delivering as a normal change', async () => {
    await push(rec('a', '2024-01-01T00:00:00.000Z'))
    const cursor = await seqOf('a')
    await push(rec('a', '2024-01-01T00:05:00.000Z', { deletedAt: '2024-01-01T00:05:00.000Z' }))

    const changes = await listSince(DB, 'task', USER, cursor)
    expect(changes[0]!.record.deletedAt).toBe('2024-01-01T00:05:00.000Z')
  })
})

describe('parseCursor', () => {
  it('reads a seq cursor', () => {
    expect(parseCursor('{"task":12,"note":5}')).toEqual({ task: 12, note: 5 })
  })

  it('treats a legacy ISO cursor, junk, and empty as start-from-scratch', () => {
    // A deployed client holding an old timestamp cursor re-pulls everything once
    // rather than silently receiving nothing.
    expect(parseCursor('2024-01-01T00:00:00.000Z')).toEqual({})
    expect(parseCursor('')).toEqual({})
    expect(parseCursor('[1,2]')).toEqual({})
    expect(parseCursor('null')).toEqual({})
  })

  it('drops non-numeric positions rather than binding them into SQL', () => {
    expect(parseCursor('{"task":"12","note":3}')).toEqual({ note: 3 })
  })
})
