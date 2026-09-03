import { createRepositories, getActiveWorkspaceId, type Repositories } from '@devdesk/database'
import type { EntityKind, Task, Note, Notebook, Snippet, TaskStatus, Workspace } from '@devdesk/shared'
import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'
import { bus } from '@/lib/events'
import { decryptNote, encryptNoteFields, encryptUnlockedNoteFields, isNoteUnlocked, isProtectedNote, protectedPlaceholder } from '@/lib/vault'

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
      const [tasks, notes, notebooks, snippets] = await Promise.all([
        repos.tasks.byWorkspace(id),
        repos.notes.byWorkspace(id),
        repos.notebooks.byWorkspace(id),
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
      for (const notebook of notebooks) {
        await repos.notebooks.remove(notebook.id)
        bus.emit('entity:mutated', { kind: 'notebook', id: notebook.id, op: 'delete' })
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

  const noteBase = entityService<Note>(repos.notes, 'note')
  const showNote = async (note: Note): Promise<Note> => {
    if (!isProtectedNote(note) || !isNoteUnlocked(note)) return isProtectedNote(note) ? protectedPlaceholder(note) : note
    return decryptNote(note)
  }
  const notes = {
    async get(id: string) {
      const note = await noteBase.get(id)
      return note && showNote(note)
    },
    async list() {
      return Promise.all((await noteBase.list()).map(showNote))
    },
    async create(data: Parameters<typeof repos.notes.create>[0]) {
      const source = data as Partial<Note>
      const stored = await noteBase.create({ ...source, body: source.body ?? '', tags: source.tags ?? [], taskId: source.taskId ?? null, notebookId: source.notebookId ?? null, isProtected: false, encrypted: null } as never)
      return showNote(stored)
    },
    async update(id: string, patch: Parameters<typeof repos.notes.update>[1]) {
      const stored = await repos.notes.getWithDeleted(id)
      if (!stored) throw new Error(`notes ${id} not found`)
      const source = patch as Partial<Note>
      let updated: Note
      if (isProtectedNote(stored)) {
        const current = isProtectedNote(stored) ? await decryptNote(stored) : stored
        updated = await noteBase.update(id, {
          ...source,
          ...await encryptUnlockedNoteFields(stored, {
            title: source.title ?? current.title,
            body: source.body ?? current.body,
            tags: source.tags ?? current.tags,
            taskId: source.taskId ?? current.taskId,
            notebookId: source.notebookId ?? current.notebookId,
          }),
        } as never)
      } else {
        updated = await noteBase.update(id, patch as never)
      }
      return showNote(updated)
    },
    async remove(id: string) { await noteBase.remove(id) },
    async protect(id: string, passphrase: string) {
      const stored = await repos.notes.getWithDeleted(id)
      if (!stored) throw new Error(`notes ${id} not found`)
      if (isProtectedNote(stored)) return showNote(stored)
      const updated = await noteBase.update(id, await encryptNoteFields({ title: stored.title, body: stored.body, tags: stored.tags, taskId: stored.taskId, notebookId: stored.notebookId }, passphrase) as never)
      return showNote(updated)
    },
    async changeKey(id: string, passphrase: string) {
      const stored = await repos.notes.getWithDeleted(id)
      if (!stored) throw new Error(`notes ${id} not found`)
      if (!isProtectedNote(stored)) throw new Error('Protect this note before changing its key.')
      const plain = await decryptNote(stored)
      const updated = await noteBase.update(id, await encryptNoteFields({ title: plain.title, body: plain.body, tags: plain.tags, taskId: plain.taskId, notebookId: plain.notebookId }, passphrase) as never)
      return showNote(updated)
    },
    async unprotect(id: string) {
      const stored = await repos.notes.getWithDeleted(id)
      if (!stored || !isProtectedNote(stored)) return stored && showNote(stored)
      const plain = await decryptNote(stored)
      const updated = await noteBase.update(id, {
        title: plain.title, body: plain.body, tags: plain.tags, taskId: plain.taskId, notebookId: plain.notebookId, isProtected: false, encrypted: null,
      } as never)
      return showNote(updated)
    },
    async byTask(taskId: string) { return (await notes.list()).filter((note) => note.taskId === taskId) },
  }
  const notebookBase = entityService<Notebook>(repos.notebooks, 'notebook')
  const notebooks = {
    ...notebookBase,
    async create(data: Parameters<typeof repos.notebooks.create>[0]) {
      const input = data as Partial<Notebook>
      return notebookBase.create({ ...input, parentId: input.parentId ?? null } as never)
    },
    children: repos.notebooks.children.bind(repos.notebooks),
    async remove(id: string) {
      const notebook = await repos.notebooks.get(id)
      if (!notebook) return
      const [children, notes] = await Promise.all([repos.notebooks.children(id), repos.notes.byWorkspace(notebook.workspaceId)])
      await Promise.all([
        ...children.map((child) => repos.notebooks.update(child.id, { parentId: notebook.parentId } as never)),
        ...notes.filter((note) => note.notebookId === id).map((note) => repos.notes.update(note.id, { notebookId: notebook.parentId } as never)),
      ])
      await repos.notebooks.remove(id)
      bus.emit('entity:mutated', { kind: 'notebook', id, op: 'delete' })
      for (const child of children) bus.emit('entity:mutated', { kind: 'notebook', id: child.id, op: 'upsert' })
      for (const note of notes) if (note.notebookId === id) bus.emit('entity:mutated', { kind: 'note', id: note.id, op: 'upsert' })
    },
  }
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

  return { workspaces, tasks, notes, notebooks, snippets, preferences, toolUsage, bootstrap }
}

export type Services = ReturnType<typeof createServices>

// App-wide singleton bound to the shared Dexie instance. Tests build their own
// via createServices(createRepositories(testDb)).
// ponytail: module singleton over provide/inject — one instance, no wiring ceremony.
export const services = createServices()
