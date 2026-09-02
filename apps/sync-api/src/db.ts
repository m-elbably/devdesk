import type { EntityKind } from '@devdesk/shared'

// Fixed kind→table map. Never interpolate user input into SQL — table names come
// only from this constant, so the string interpolation below is injection-safe.
const TABLES: Record<EntityKind, string> = {
  workspace: 'workspaces',
  task: 'tasks',
  note: 'notes',
  notebook: 'notebooks',
  snippet: 'snippets',
  setting: 'settings',
}
export const ALL_KINDS = Object.keys(TABLES) as EntityKind[]

interface SyncRecord {
  id: string
  workspaceId: string
  revision: number
  updatedAt: string
  deletedAt: string | null
  [k: string]: unknown
}

// Last-write-wins lives in the WHERE clause, not in JS: the row only updates when the
// incoming write is newer, so accept-or-reject and the revision bump happen atomically
// in one statement. A rejected (stale) write updates nothing and RETURNING comes back
// empty — the caller re-fetches those rows in a single follow-up batch.
//
// `seq` is the delivery order pull reads, and it is assigned *here* rather than taken
// from the client, because `updated_at` is a client clock and cannot be trusted to
// order anything (see migration 0002). Computing it as MAX+1 inside the statement makes
// it atomic: SQLite serializes writers, so two concurrent pushes get distinct values.
// A stale write updates nothing and so consumes no seq — correct, nothing changed to
// deliver.
//
// Primary key is (id, user_id) so two different users
// generating the same id land in separate rows instead of conflicting.
const upsertSql = (table: string) => `
  INSERT INTO ${table} (id, user_id, workspace_id, revision, updated_at, deleted_at, data, seq)
  VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM ${table} WHERE user_id = ?))
  ON CONFLICT(id, user_id) DO UPDATE SET
    workspace_id = excluded.workspace_id,
    revision = ${table}.revision + 1,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    data = json_set(excluded.data, '$.revision', ${table}.revision + 1),
    seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM ${table} WHERE user_id = ?)
  WHERE excluded.updated_at > ${table}.updated_at
  RETURNING data
`

/**
 * Upsert a whole push batch in one D1 round trip (plus a second, smaller round trip
 * only for ops that lost the LWW check and need their current server copy echoed
 * back). Order of the returned array matches `ops`.
 */
export async function upsertRecords(
  DB: D1Database,
  userId: string,
  ops: { kind: EntityKind; incoming: SyncRecord }[],
): Promise<SyncRecord[]> {
  if (ops.length === 0) return []

  const writes = await DB.batch<{ data: string }>(
    ops.map(({ kind, incoming }) =>
      DB.prepare(upsertSql(TABLES[kind])).bind(
        incoming.id,
        userId,
        incoming.workspaceId,
        incoming.revision,
        incoming.updatedAt,
        incoming.deletedAt,
        JSON.stringify(incoming),
        userId, // seq subquery, INSERT branch
        userId, // seq subquery, DO UPDATE branch
      ),
    ),
  )

  const out: SyncRecord[] = new Array(ops.length)
  const staleIdx: number[] = []
  writes.forEach((r, i) => {
    if (r.results[0]) out[i] = JSON.parse(r.results[0].data) as SyncRecord
    else staleIdx.push(i)
  })

  if (staleIdx.length) {
    const reads = await DB.batch<{ data: string }>(
      staleIdx.map((i) => {
        const op = ops[i]!
        return DB.prepare(`SELECT data FROM ${TABLES[op.kind]} WHERE id = ? AND user_id = ?`).bind(
          op.incoming.id,
          userId,
        )
      }),
    )
    staleIdx.forEach((i, j) => {
      out[i] = JSON.parse(reads[j]!.results[0]!.data) as SyncRecord
    })
  }

  return out
}

/** A stored record plus its server-assigned delivery position. `seq` is a column, not
 *  part of the JSON blob, so it has to be selected alongside `data`. */
export interface SeqRecord {
  seq: number
  record: SyncRecord
}

async function readData(
  DB: D1Database,
  kind: EntityKind,
  userId: string,
  cursorClause: string,
  binds: unknown[],
): Promise<SeqRecord[]> {
  const table = TABLES[kind]
  const { results } = await DB.prepare(
    `SELECT seq, data FROM ${table} WHERE user_id = ?${cursorClause} ORDER BY seq`,
  )
    .bind(userId, ...binds)
    .all<{ seq: number; data: string }>()
  return (results ?? []).map((r) => ({ seq: r.seq, record: JSON.parse(r.data) as SyncRecord }))
}

export const listSince = (DB: D1Database, kind: EntityKind, userId: string, seq: number) =>
  readData(DB, kind, userId, ' AND seq > ?', [seq])

export const listAll = (DB: D1Database, kind: EntityKind, userId: string) =>
  readData(DB, kind, userId, '', [])
