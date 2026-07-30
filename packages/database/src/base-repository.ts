import type { Table } from 'dexie'
import type { SyncedRecord } from '@devdesk/shared'
import { newId, nowIso } from '@devdesk/utils'
import { getActiveWorkspaceId } from './workspace-context'

/** Fields the caller provides on create; the rest are generated. */
export type NewData<T extends SyncedRecord> = Omit<T, keyof SyncedRecord> & {
  id?: string
  workspaceId?: string
}

export type UpdateData<T extends SyncedRecord> = Partial<Omit<T, keyof SyncedRecord>>

/**
 * Generic data access over one Dexie table. Owns the invariants every synced
 * entity shares: id/timestamp generation, revision bumping on write, soft delete,
 * and last-write-wins merging of records pulled from the server.
 *
 * Reads exclude soft-deleted rows; sync code uses the *WithDeleted variants.
 */
export class BaseRepository<T extends SyncedRecord> {
  constructor(protected readonly table: Table<T, string>) {}

  async get(id: string): Promise<T | undefined> {
    const row = await this.table.get(id)
    return row && row.deletedAt === null ? row : undefined
  }

  async getWithDeleted(id: string): Promise<T | undefined> {
    return this.table.get(id)
  }

  /** Live records in the active workspace. Scoping here means switching a workspace
   *  re-scopes every listing in the app without touching a single call site. */
  async list(): Promise<T[]> {
    const workspaceId = getActiveWorkspaceId()
    return this.table.filter((r) => r.deletedAt === null && r.workspaceId === workspaceId).toArray()
  }

  byWorkspace(workspaceId: string): Promise<T[]> {
    return this.table
      .where('workspaceId')
      .equals(workspaceId)
      .filter((r) => r.deletedAt === null)
      .toArray()
  }

  async create(data: NewData<T>): Promise<T> {
    const now = nowIso()
    const record = {
      workspaceId: getActiveWorkspaceId(),
      ...data,
      id: data.id ?? newId(),
      userId: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as unknown as T
    await this.table.add(record)
    return record
  }

  async update(id: string, patch: UpdateData<T>): Promise<T> {
    const existing = await this.table.get(id)
    if (!existing) throw new Error(`${this.table.name} ${id} not found`)
    const updated = {
      ...existing,
      ...patch,
      revision: existing.revision + 1,
      updatedAt: nowIso(),
    } as T
    await this.table.put(updated)
    return updated
  }

  /** Soft delete: marks deletedAt so the row still syncs as a tombstone. */
  async remove(id: string): Promise<void> {
    const existing = await this.table.get(id)
    if (!existing) return
    const now = nowIso()
    await this.table.put({ ...existing, deletedAt: now, updatedAt: now, revision: existing.revision + 1 })
  }

  async hardDelete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  /**
   * Merge a server record (from sync pull) using last-write-wins on updatedAt.
   *
   * Ties take the remote copy. The server's own check is a strict `>`, so it keeps its
   * row on a tie — the two sides have to disagree for both to converge on the same
   * winner, and the server is the one every device can see. This also lets the
   * revision the server bumps on an accepted push land locally, since that record comes
   * back with an unchanged updatedAt.
   */
  async applyRemote(record: T): Promise<void> {
    const local = await this.table.get(record.id)
    if (!local || record.updatedAt >= local.updatedAt) {
      await this.table.put(record)
    }
  }
}
