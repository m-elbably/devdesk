import Dexie, { type Table } from 'dexie'
import type { Workspace, Task, Note, Snippet, Setting, SyncOperation } from '@devdesk/shared'

// Local-only records (never synced in v1) — favorites, recent tools and tool history.
export interface Favorite {
  toolId: string
  createdAt: string
}

export interface RecentTool {
  toolId: string
  lastUsedAt: string
  count: number
}

export interface ToolHistoryEntry {
  id: string
  toolId: string
  /** A user-named input preset; unlabelled rows are ordinary execution history. */
  label?: string
  /** Trimmed/omitted per privacy level by the service layer, never here. */
  input: unknown
  output: unknown
  createdAt: string
}

export class DevDeskDB extends Dexie {
  workspaces!: Table<Workspace, string>
  tasks!: Table<Task, string>
  notes!: Table<Note, string>
  snippets!: Table<Snippet, string>
  settings!: Table<Setting, string>
  favorites!: Table<Favorite, string>
  recentTools!: Table<RecentTool, string>
  toolHistory!: Table<ToolHistoryEntry, string>
  syncQueue!: Table<SyncOperation, string>

  constructor(name = 'devdesk') {
    super(name)
    // Indexes: only what we actually query on. deletedAt lets us filter soft-deletes;
    // compound [workspaceId+status] powers the board columns.
    this.version(1).stores({
      workspaces: 'id, updatedAt, deletedAt',
      tasks: 'id, workspaceId, [workspaceId+status], status, position, dueDate, updatedAt, deletedAt',
      notes: 'id, workspaceId, taskId, updatedAt, deletedAt',
      snippets: 'id, workspaceId, taskId, language, updatedAt, deletedAt',
      settings: 'id, &key, updatedAt, deletedAt',
      favorites: 'toolId, createdAt',
      recentTools: 'toolId, lastUsedAt',
      toolHistory: 'id, toolId, [toolId+createdAt], createdAt',
      syncQueue: 'id, kind, entityId, createdAt',
    })
    // Quick capture originally wrote only its title and description. Repair
    // those rows on upgrade so every task still belongs to a visible column.
    this.version(2).stores({
      workspaces: 'id, updatedAt, deletedAt',
      tasks: 'id, workspaceId, [workspaceId+status], status, position, dueDate, updatedAt, deletedAt',
      notes: 'id, workspaceId, taskId, updatedAt, deletedAt',
      snippets: 'id, workspaceId, taskId, language, updatedAt, deletedAt',
      settings: 'id, &key, updatedAt, deletedAt',
      favorites: 'toolId, createdAt',
      recentTools: 'toolId, lastUsedAt',
      toolHistory: 'id, toolId, [toolId+createdAt], createdAt',
      syncQueue: 'id, kind, entityId, createdAt',
    }).upgrade((tx) => tx.table('tasks').toCollection().modify((task) => {
      task.description ??= ''
      task.status ??= 'todo'
      task.priority ??= 'medium'
      task.tags ??= []
      task.dueDate ??= null
      task.position ??= 0
    }))
  }
}

// Single shared instance for the app. Tests construct their own with a unique name.
export const db = new DevDeskDB()

/** Dump every table to a single JSON blob, for local backups. */
export async function exportBackup(source: DevDeskDB = db): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const table of source.tables) {
    data[table.name] = await table.toArray()
  }
  return JSON.stringify({ version: source.verno, exportedAt: new Date().toISOString(), data }, null, 2)
}

/** Load a JSON blob from `exportBackup` back in. Upserts by primary key — existing rows with the same id are overwritten, others are left alone. */
export async function importBackup(json: string, target: DevDeskDB = db): Promise<void> {
  const parsed = JSON.parse(json) as { data?: Record<string, unknown[]> }
  const data = parsed.data
  if (!data || typeof data !== 'object') throw new Error('Not a DevDesk backup file.')

  await target.transaction('rw', target.tables, async () => {
    for (const table of target.tables) {
      const rows = data[table.name]
      if (Array.isArray(rows) && rows.length) await table.bulkPut(rows as never[])
    }
  })
}
