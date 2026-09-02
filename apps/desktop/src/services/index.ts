import { createRepositories, getActiveWorkspaceId, type Repositories } from '@devdesk/database'
import type { EntityKind, Task, Note, Snippet, TaskStatus, Workspace } from '@devdesk/shared'
import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'
import { bus } from '@/lib/events'

// A thin CRUD service over a repository that also announces mutations on the bus.
// The bus event is what Phase 8's sync queue and any UI listeners react to.
function entityService<T extends { id: string }>(
  repo: {
    create: (d: never) => Promise<T>
    update: (id: string, p: never) => Promise<T>
    remove: (id: string) => Promise<void>
    get: (id: string) => Promise<T | undefined>
    list: () => Promise<T[]>
  },
  kind: EntityKind,
) {
  return {
    get: repo.get.bind(repo),
    list: repo.list.bind(repo),
    async create(data: Parameters<typeof repo.create>[0]) {
      const r = await repo.create(data)
      bus.emit('entity:mutated', { kind, id: r.id, op: 'upsert' })
      return r
    },
    async update(id: string, patch: Parameters<typeof repo.update>[1]) {
      const r = await repo.update(id, patch)
      bus.emit('entity:mutated', { kind, id, op: 'upsert' })
      return r
    },
    async remove(id: string) {
      await repo.remove(id)
      bus.emit('entity:mutated', { kind, id, op: 'delete' })
    },
  }
}

export function createServices(repos: Repositories = createRepositories()) {
  const workspaces = {
    ...entityService<Workspace>(repos.workspaces, 'workspace'),
    /** Deleting a workspace tombstones every task/note/snippet inside it too —
     *  otherwise they'd linger locally, invisible, and keep syncing under a
     *  workspace nobody can switch to any more. */
    async remove(id: string) {
      const [tasks, notes, snippets] = await Promise.all([
        repos.tasks.byWorkspace(id),
        repos.notes.byWorkspace(id),
        repos.snippets.byWorkspace(id),
      ])
      for (const t of tasks) {
        await repos.tasks.remove(t.id)
        bus.emit('entity:mutated', { kind: 'task', id: t.id, op: 'delete' })
      }
      for (const n of notes) {
        await repos.notes.remove(n.id)
        bus.emit('entity:mutated', { kind: 'note', id: n.id, op: 'delete' })
      }
      for (const s of snippets) {
        await repos.snippets.remove(s.id)
        bus.emit('entity:mutated', { kind: 'snippet', id: s.id, op: 'delete' })
      }
      await repos.workspaces.remove(id)
      bus.emit('entity:mutated', { kind: 'workspace', id, op: 'delete' })
    },
  }

  const tasks = {
    ...entityService<Task>(repos.tasks, 'task'),
    // A task can be created outside the board (quick capture or a tool result),
    // so the service owns the board fields that otherwise only TaskDialog fills.
    async create(data: Parameters<typeof repos.tasks.create>[0]) {
      const input = data as Partial<Task>
      const status = input.status ?? 'todo'
      const existing = await repos.tasks.byStatus(getActiveWorkspaceId(), status)
      const r = await repos.tasks.create({
        ...input,
        description: input.description ?? '',
        status,
        priority: input.priority ?? 'medium',
        tags: input.tags ?? [],
        dueDate: input.dueDate ?? null,
        position: input.position ?? existing.length,
      } as never)
      bus.emit('entity:mutated', { kind: 'task', id: r.id, op: 'upsert' })
      return r
    },
    byWorkspace: repos.tasks.byWorkspace.bind(repos.tasks),
    byStatus: repos.tasks.byStatus.bind(repos.tasks),
    /** Move a task to a column/position (drag & drop). */
    async move(id: string, status: TaskStatus, position: number) {
      const r = await repos.tasks.update(id, { status, position } as never)
      bus.emit('entity:mutated', { kind: 'task', id, op: 'upsert' })
      return r
    },
  }

  const notes = { ...entityService<Note>(repos.notes, 'note'), byTask: repos.notes.byTask.bind(repos.notes) }
  const snippets = {
    ...entityService<Snippet>(repos.snippets, 'snippet'),
    byTask: repos.snippets.byTask.bind(repos.snippets),
  }

  const preferences = {
    favorites: repos.favorites,
    recent: repos.recentTools,
    async toggleFavorite(toolId: string) {
      const isFavorite = await repos.favorites.toggle(toolId)
      bus.emit('favorite:changed', { toolId, isFavorite })
      return isFavorite
    },
  }

  const toolUsage = {
    /** Record that a tool was opened — drives the Recent list. */
    async open(toolId: string) {
      await repos.recentTools.touch(toolId)
      bus.emit('tool:opened', { toolId })
    },
    history: repos.toolHistory,
  }

  /** Ensure a default workspace row exists. Idempotent; run once at startup.
   *  Keyed on `isDefault`, not on the id, so an install seeded before the default id
   *  became a uuid adopts the workspace it already has instead of gaining a second one. */
  async function bootstrap() {
    const existing = await repos.workspaces.list()
    if (existing.some((w) => w.isDefault)) return
    if (await repos.workspaces.getWithDeleted(DEFAULT_WORKSPACE_ID)) return
    await repos.workspaces.create({ id: DEFAULT_WORKSPACE_ID, name: 'Personal', isDefault: true } as never)
  }

  return { workspaces, tasks, notes, snippets, preferences, toolUsage, bootstrap }
}

export type Services = ReturnType<typeof createServices>

// App-wide singleton bound to the shared Dexie instance. Tests build their own
// via createServices(createRepositories(testDb)).
// ponytail: module singleton over provide/inject — one instance, no wiring ceremony.
export const services = createServices()
