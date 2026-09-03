import type { Task, Note, Notebook, Snippet, Workspace, Setting, TaskStatus } from '@devdesk/shared'
import { newId, nowIso } from '@devdesk/utils'
import { BaseRepository, type NewData } from './base-repository'
import {
  db as sharedDb,
  type AiConversationRow,
  type AiProviderRow,
  type DevDeskDB,
  type Favorite,
  type RecentTool,
  type ToolHistoryEntry,
} from './db'
import { RECENT_TOOLS_LIMIT, TOOL_HISTORY_LIMIT } from '@devdesk/shared'

export class WorkspaceRepository extends BaseRepository<Workspace> {
  /** Workspaces are the thing being switched between, so they are never scoped to one. */
  list(): Promise<Workspace[]> {
    return this.table.filter((w) => w.deletedAt === null).toArray()
  }

  /** `workspaceId` is part of the shape every synced entity shares; for a workspace the
   *  only value that means anything is its own id. Without this it would inherit
   *  whatever workspace happened to be active at create time. */
  create(data: NewData<Workspace>): Promise<Workspace> {
    const id = data.id ?? newId()
    return super.create({ ...data, id, workspaceId: id })
  }
}

export class TaskRepository extends BaseRepository<Task> {
  byStatus(workspaceId: string, status: TaskStatus): Promise<Task[]> {
    return this.table
      .where('[workspaceId+status]')
      .equals([workspaceId, status])
      .filter((t) => t.deletedAt === null)
      .sortBy('position')
  }
}

export class NoteRepository extends BaseRepository<Note> {
  byTask(taskId: string): Promise<Note[]> {
    return this.table.where('taskId').equals(taskId).filter((n) => n.deletedAt === null).toArray()
  }
}

export class NotebookRepository extends BaseRepository<Notebook> {
  children(parentId: string | null): Promise<Notebook[]> {
    return this.table.filter((notebook) => notebook.parentId === parentId && notebook.deletedAt === null).toArray()
  }
}

export class SnippetRepository extends BaseRepository<Snippet> {
  byTask(taskId: string): Promise<Snippet[]> {
    return this.table.where('taskId').equals(taskId).filter((s) => s.deletedAt === null).toArray()
  }
}

export class SettingRepository extends BaseRepository<Setting> {}

/** Local-only: pinned tools. Not part of sync in v1. */
export class FavoriteRepository {
  constructor(private readonly db: DevDeskDB) {}

  list(): Promise<Favorite[]> {
    return this.db.favorites.orderBy('createdAt').toArray()
  }

  async isFavorite(toolId: string): Promise<boolean> {
    return (await this.db.favorites.get(toolId)) !== undefined
  }

  async toggle(toolId: string): Promise<boolean> {
    const existing = await this.db.favorites.get(toolId)
    if (existing) {
      await this.db.favorites.delete(toolId)
      return false
    }
    await this.db.favorites.put({ toolId, createdAt: nowIso() })
    return true
  }
}

/** Local-only: most-recently-used tools, capped at RECENT_TOOLS_LIMIT. */
export class RecentToolRepository {
  constructor(private readonly db: DevDeskDB) {}

  list(): Promise<RecentTool[]> {
    return this.db.recentTools.orderBy('lastUsedAt').reverse().limit(RECENT_TOOLS_LIMIT).toArray()
  }

  async touch(toolId: string): Promise<void> {
    const existing = await this.db.recentTools.get(toolId)
    await this.db.recentTools.put({
      toolId,
      lastUsedAt: nowIso(),
      count: (existing?.count ?? 0) + 1,
    })
    // Trim beyond the cap so this table can't grow unbounded.
    const all = await this.db.recentTools.orderBy('lastUsedAt').reverse().toArray()
    const stale = all.slice(RECENT_TOOLS_LIMIT)
    if (stale.length) await this.db.recentTools.bulkDelete(stale.map((r) => r.toolId))
  }
}

/** Local-only: tool execution history, respecting privacy (service decides what to store). */
export class ToolHistoryRepository {
  constructor(private readonly db: DevDeskDB) {}

  byTool(toolId: string): Promise<ToolHistoryEntry[]> {
    return this.db.toolHistory.where('toolId').equals(toolId).reverse().sortBy('createdAt')
  }

  async add(entry: ToolHistoryEntry): Promise<void> {
    await this.db.toolHistory.add(entry)
    const all = await this.db.toolHistory.orderBy('createdAt').reverse().toArray()
    const stale = all.slice(TOOL_HISTORY_LIMIT)
    if (stale.length) await this.db.toolHistory.bulkDelete(stale.map((e) => e.id))
  }

  clear(toolId?: string): Promise<number> {
    return toolId ? this.db.toolHistory.where('toolId').equals(toolId).delete() : this.db.toolHistory.clear().then(() => 0)
  }
}

/**
 * Local-only: configured AI providers, API keys included.
 *
 * Not a `BaseRepository`: that base is for synced entities, and inheriting it would
 * put these rows a short step away from the sync queue. Plain class, plain table,
 * the same shape `FavoriteRepository` uses for the same reason.
 */
export class AiProviderRepository {
  constructor(private readonly db: DevDeskDB) {}

  list(): Promise<AiProviderRow[]> {
    return this.db.aiProviders.toArray()
  }

  get(id: string): Promise<AiProviderRow | undefined> {
    return this.db.aiProviders.get(id)
  }

  async save(row: Omit<AiProviderRow, 'createdAt' | 'updatedAt'> & Partial<Pick<AiProviderRow, 'createdAt'>>): Promise<AiProviderRow> {
    const existing = await this.db.aiProviders.get(row.id)
    const saved: AiProviderRow = {
      ...row,
      createdAt: existing?.createdAt ?? row.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    await this.db.aiProviders.put(saved)
    return saved
  }

  async remove(id: string): Promise<void> {
    // Hard delete, not the soft delete synced entities use: there is no peer to tell
    // about the removal, and a tombstone would only keep the API key on disk.
    await this.db.aiProviders.delete(id)
  }
}

/** Local-only: assistant conversations, newest first. */
export class AiConversationRepository {
  constructor(private readonly db: DevDeskDB) {}

  list(): Promise<AiConversationRow[]> {
    return this.db.aiConversations.orderBy('updatedAt').reverse().toArray()
  }

  get(id: string): Promise<AiConversationRow | undefined> {
    return this.db.aiConversations.get(id)
  }

  async save(row: Omit<AiConversationRow, 'createdAt' | 'updatedAt'> & Partial<Pick<AiConversationRow, 'createdAt'>>): Promise<AiConversationRow> {
    const existing = await this.db.aiConversations.get(row.id)
    const saved: AiConversationRow = {
      ...row,
      createdAt: existing?.createdAt ?? row.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    await this.db.aiConversations.put(saved)
    return saved
  }

  async remove(id: string): Promise<void> {
    await this.db.aiConversations.delete(id)
  }

  async clear(): Promise<void> {
    await this.db.aiConversations.clear()
  }
}

/** Bundle of every repository, bound to one database instance. */
export function createRepositories(database: DevDeskDB = sharedDb) {
  return {
    workspaces: new WorkspaceRepository(database.workspaces),
    tasks: new TaskRepository(database.tasks),
    notes: new NoteRepository(database.notes),
    notebooks: new NotebookRepository(database.notebooks),
    snippets: new SnippetRepository(database.snippets),
    settings: new SettingRepository(database.settings),
    favorites: new FavoriteRepository(database),
    recentTools: new RecentToolRepository(database),
    toolHistory: new ToolHistoryRepository(database),
    aiProviders: new AiProviderRepository(database),
    aiConversations: new AiConversationRepository(database),
  }
}

export type Repositories = ReturnType<typeof createRepositories>
