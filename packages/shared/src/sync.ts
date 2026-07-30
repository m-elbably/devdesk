import { z } from 'zod'
import { EntityKind } from './entities'

export const SyncOp = z.enum(['upsert', 'delete'])
export type SyncOp = z.infer<typeof SyncOp>

/** A single pending mutation waiting to be pushed to the server. */
export const SyncOperation = z.object({
  id: z.string(),
  kind: EntityKind,
  entityId: z.string(),
  op: SyncOp,
  /** Full record snapshot for upserts; null for deletes. */
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  attempts: z.number().int().nonnegative().default(0),
})
export type SyncOperation = z.infer<typeof SyncOperation>

// ---- API payloads ----

export const PushRequest = z.object({
  operations: z.array(SyncOperation),
})
export type PushRequest = z.infer<typeof PushRequest>

export const PushResult = z.object({
  /** Operation ids the server accepted (client removes these from its queue). */
  acked: z.array(z.string()),
  /** Server-authoritative records that changed as a result (with bumped revisions). */
  applied: z.array(
    z.object({
      kind: EntityKind,
      record: z.record(z.unknown()),
    }),
  ),
})
export type PushResult = z.infer<typeof PushResult>

export const PullResponse = z.object({
  /** Server cursor: pass back on the next pull to get only newer changes. */
  cursor: z.string(),
  changes: z.array(
    z.object({
      kind: EntityKind,
      record: z.record(z.unknown()),
    }),
  ),
})
export type PullResponse = z.infer<typeof PullResponse>
