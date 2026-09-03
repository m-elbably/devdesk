import Dexie, { type Table } from 'dexie'
import type { Workspace, Task, Note, Notebook, Snippet, Setting, SyncOperation } from '@devdesk/shared'

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

/**
 * A configured AI provider, including its API key.
 *
 * **Local-only, deliberately.** The `settings` table would have been the obvious
 * home, but `'setting'` is in `EntityKind` and wired through sync end to end — a key
 * written there would be pushed to the sync server. This table is absent from
 * `EntityKind`, `repoByKind` and `tableByKind`, which is what keeps it on the device.
 * `exportBackup` strips the key as well; see `REDACTED_FIELDS`.
 *
 * Kept structurally independent of `ProviderConfig` in `@devdesk/ai`: this package
 * describes rows on disk and must not depend on the AI layer, and a stored row has
 * to stay readable after the config type moves on.
 */
export interface AiProviderRow {
  id: string
  kind: string
  label: string
  baseUrl: string
  apiKey: string
  model: string
  transport: string
  redact: boolean
  createdAt: string
  updatedAt: string
}

/**
 * One assistant conversation, whole thread in a single row.
 *
 * Messages are a JSON blob rather than their own table because nothing queries
 * inside a thread — the panel loads one conversation at a time and writes it back.
 * Local-only for the same reason as `aiProviders`: a transcript can contain anything
 * the user pasted into it.
 */
export interface AiConversationRow {
  id: string
  title: string
  /** `ChatMessage[]` from @devdesk/ai, stored opaquely. */
  messages: unknown[]
  providerId: string
  model: string
  createdAt: string
  updatedAt: string
}

export class DevDeskDB extends Dexie {
  workspaces!: Table<Workspace, string>
  tasks!: Table<Task, string>
  notes!: Table<Note, string>
  notebooks!: Table<Notebook, string>
  snippets!: Table<Snippet, string>
  settings!: Table<Setting, string>
  favorites!: Table<Favorite, string>
  recentTools!: Table<RecentTool, string>
  toolHistory!: Table<ToolHistoryEntry, string>
  aiProviders!: Table<AiProviderRow, string>
  aiConversations!: Table<AiConversationRow, string>
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
    this.version(3).stores({
      workspaces: 'id, updatedAt, deletedAt',
      tasks: 'id, workspaceId, [workspaceId+status], status, position, dueDate, updatedAt, deletedAt',
      notes: 'id, workspaceId, [workspaceId+notebookId], notebookId, taskId, updatedAt, deletedAt',
      notebooks: 'id, workspaceId, parentId, updatedAt, deletedAt',
      // Keep this store until every synced legacy snippet has been tombstoned.
      snippets: 'id, workspaceId, taskId, language, updatedAt, deletedAt',
      settings: 'id, &key, updatedAt, deletedAt',
      favorites: 'toolId, createdAt',
      recentTools: 'toolId, lastUsedAt',
      toolHistory: 'id, toolId, [toolId+createdAt], createdAt',
      syncQueue: 'id, kind, entityId, createdAt',
    }).upgrade((tx) => tx.table('notes').toCollection().modify((note) => {
      note.notebookId ??= null
      note.isProtected ??= false
      note.encrypted ??= null
    }))
    // AI providers and conversations. Both local-only: they hold API keys and
    // whatever the user pasted into a thread, and neither is in EntityKind.
    //
    // v4 rather than v3: the notebooks release above already shipped as 3, so
    // reusing that number would leave two different schemas claiming one version —
    // installs that already upgraded would never run this one.
    this.version(4).stores({
      workspaces: 'id, updatedAt, deletedAt',
      tasks: 'id, workspaceId, [workspaceId+status], status, position, dueDate, updatedAt, deletedAt',
      notes: 'id, workspaceId, [workspaceId+notebookId], notebookId, taskId, updatedAt, deletedAt',
      notebooks: 'id, workspaceId, parentId, updatedAt, deletedAt',
      snippets: 'id, workspaceId, taskId, language, updatedAt, deletedAt',
      settings: 'id, &key, updatedAt, deletedAt',
      favorites: 'toolId, createdAt',
      recentTools: 'toolId, lastUsedAt',
      toolHistory: 'id, toolId, [toolId+createdAt], createdAt',
      aiProviders: 'id, kind',
      aiConversations: 'id, updatedAt',
      syncQueue: 'id, kind, entityId, createdAt',
    })
  }
}

/**
 * Fields stripped from a backup, by table.
 *
 * A backup file is meant to be copied around and restored elsewhere, so it must not
 * carry credentials. `exportBackup` walks `source.tables` generically, which means a
 * new table is included the moment it exists — convenient, and exactly why this list
 * has to exist alongside it.
 */
export const REDACTED_FIELDS: Record<string, readonly string[]> = {
  aiProviders: ['apiKey'],
}

/** Blank out the redacted fields on one row, leaving everything else intact. */
function redactRow(tableName: string, row: unknown): unknown {
  const fields = REDACTED_FIELDS[tableName]
  if (!fields || typeof row !== 'object' || row === null) return row

  const copy = { ...(row as Record<string, unknown>) }
  for (const field of fields) {
    // Emptied rather than deleted, so a restored provider keeps its shape and the
    // settings UI shows it as "needs a key" instead of as malformed.
    if (field in copy) copy[field] = ''
  }
  return copy
}

// Single shared instance for the app. Tests construct their own with a unique name.
export const db = new DevDeskDB()

/** Dump every table to a single JSON blob, for local backups. API keys are stripped. */
export async function exportBackup(source: DevDeskDB = db): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const table of source.tables) {
    const rows = await table.toArray()
    data[table.name] = table.name in REDACTED_FIELDS ? rows.map((row) => redactRow(table.name, row)) : rows
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
