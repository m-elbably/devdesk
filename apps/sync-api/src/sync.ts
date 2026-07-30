import { Hono } from 'hono'
import { z } from 'zod'
import { PushRequest, syncedFields } from '@devdesk/shared'
import type { Env } from './index'
import { ALL_KINDS, listAll, listSince, upsertRecords, type SeqRecord } from './db'

export const syncRoutes = new Hono<{ Bindings: Env }>()

// PushRequest types payload as an opaque record; the columns we index on must still be
// present. Defaults fill the optional ones, so a partial record 400s instead of 500ing
// on a NULL bind. passthrough keeps the entity-specific fields for the JSON blob.
const SyncedPayload = z.object(syncedFields).passthrough()

const userId = (c: { get: (k: 'jwtPayload') => unknown }) => (c.get('jwtPayload') as { sub: string }).sub

/**
 * The cursor stays an opaque string on the wire (clients only ever store and echo it),
 * but it now carries per-kind `seq` positions as JSON — per-kind because `seq` counts
 * per table.
 *
 * Old cursors were ISO timestamps. Anything unparseable means "start from scratch": the
 * client re-pulls everything once and lands on a seq cursor, with no coordinated
 * client/server rollout. That full re-pull is safe because the client merges with
 * last-write-wins, so it cannot clobber newer local data.
 */
export function parseCursor(raw: string): Record<string, number> {
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === 'number'),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

// Collect records across all kinds into a single change list, advancing the cursor to the
// max seq seen per kind. Kinds with no changes keep their previous position.
function toChanges(perKind: { kind: string; records: SeqRecord[] }[], base: Record<string, number>) {
  const changes: { kind: string; record: Record<string, unknown> }[] = []
  const cursor = { ...base }
  for (const { kind, records } of perKind) {
    for (const { seq, record } of records) {
      changes.push({ kind, record: record as unknown as Record<string, unknown> })
      if (seq > (cursor[kind] ?? 0)) cursor[kind] = seq
    }
  }
  return { changes, cursor: JSON.stringify(cursor) }
}

/** Full snapshot of the user's data — used on first sync / new device. */
syncRoutes.get('/bootstrap', async (c) => {
  const uid = userId(c)
  const perKind = await Promise.all(
    ALL_KINDS.map(async (kind) => ({ kind, records: await listAll(c.env.DB, kind, uid) })),
  )
  return c.json(toChanges(perKind, {}))
})

/** Apply queued client mutations with last-write-wins; echo the authoritative records back. */
syncRoutes.post('/push', async (c) => {
  const parsed = PushRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid push payload' }, 400)
  const uid = userId(c)

  // Validate every op before touching the DB, so one bad payload 400s the whole
  // request instead of leaving earlier ops already written.
  const toWrite: { kind: (typeof parsed.data.operations)[number]['kind']; incoming: never }[] = []
  for (const op of parsed.data.operations) {
    if (!op.payload) continue
    const payload = SyncedPayload.safeParse(op.payload)
    if (!payload.success) return c.json({ error: `Invalid ${op.kind} payload in operation ${op.id}` }, 400)
    toWrite.push({ kind: op.kind, incoming: payload.data as never })
  }

  // One batched round trip for all upserts (plus a small follow-up batch for any
  // that lost the last-write-wins check and need their current copy echoed back).
  const stored = await upsertRecords(c.env.DB, uid, toWrite)
  const applied = toWrite.map(({ kind }, i) => ({ kind, record: stored[i] as unknown as Record<string, unknown> }))
  const acked = parsed.data.operations.map((op) => op.id)
  return c.json({ acked, applied })
})

/** Changes newer than the client's cursor. */
syncRoutes.get('/pull', async (c) => {
  const uid = userId(c)
  const cursor = parseCursor(c.req.query('cursor') ?? '')
  const perKind = await Promise.all(
    ALL_KINDS.map(async (kind) => ({ kind, records: await listSince(c.env.DB, kind, uid, cursor[kind] ?? 0) })),
  )
  // toChanges carries the incoming positions through, so kinds with nothing new keep theirs.
  return c.json(toChanges(perKind, cursor))
})

/** Persist the client's confirmed pull cursor (advisory). */
syncRoutes.post('/ack', async (c) => {
  const body = z.object({ cursor: z.string() }).safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Invalid ack' }, 400)
  await c.env.DB.prepare('INSERT OR REPLACE INTO sync_state (user_id, cursor) VALUES (?, ?)')
    .bind(userId(c), body.data.cursor)
    .run()
  return c.json({ ok: true })
})
