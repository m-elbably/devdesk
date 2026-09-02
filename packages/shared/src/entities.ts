import { z } from 'zod'

// ISO 8601 timestamp string, used everywhere for portability (local + D1).
const iso = z.string().datetime()

/**
 * Fields every synced record carries. `revision` drives last-write-wins:
 * the server increments it, the client stores whatever the server returns.
 * `userId` is null until the record has been claimed by an authenticated sync.
 */
export const syncedFields = {
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string().nullable().default(null),
  revision: z.number().int().nonnegative().default(0),
  createdAt: iso,
  updatedAt: iso,
  deletedAt: iso.nullable().default(null),
}

/** Structural type shared by every synced entity — used for repository generics. */
export interface SyncedRecord {
  id: string
  workspaceId: string
  userId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export const WorkspaceHome = z.object({
  toolIds: z.array(z.string()).default([]),
  noteIds: z.array(z.string()).default([]),
  snippetIds: z.array(z.string()).default([]),
})
export type WorkspaceHome = z.infer<typeof WorkspaceHome>

export const Workspace = z.object({
  ...syncedFields,
  name: z.string().min(1),
  isDefault: z.boolean().default(false),
  // The workspace is the project boundary. Keep its home configuration on the
  // synced record rather than adding a second project model.
  home: WorkspaceHome.default({ toolIds: [], noteIds: [], snippetIds: [] }),
})
export type Workspace = z.infer<typeof Workspace>

export const TaskStatus = z.enum(['backlog', 'todo', 'in_progress', 'done'])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export type TaskPriority = z.infer<typeof TaskPriority>

export const Task = z.object({
  ...syncedFields,
  title: z.string().min(1),
  description: z.string().default(''),
  status: TaskStatus.default('todo'),
  priority: TaskPriority.default('medium'),
  tags: z.array(z.string()).default([]),
  dueDate: iso.nullable().default(null),
  position: z.number().default(0),
})
export type Task = z.infer<typeof Task>

export const Note = z.object({
  ...syncedFields,
  title: z.string().default(''),
  body: z.string().default(''),
  tags: z.array(z.string()).default([]),
  taskId: z.string().nullable().default(null),
})
export type Note = z.infer<typeof Note>

export const Snippet = z.object({
  ...syncedFields,
  title: z.string().default(''),
  code: z.string().default(''),
  language: z.string().default('text'),
  tags: z.array(z.string()).default([]),
  taskId: z.string().nullable().default(null),
})
export type Snippet = z.infer<typeof Snippet>

/** All entity kinds that participate in sync. Used as the discriminator in the sync queue. */
export const EntityKind = z.enum(['workspace', 'task', 'note', 'snippet', 'setting'])
export type EntityKind = z.infer<typeof EntityKind>

export const Setting = z.object({
  ...syncedFields,
  key: z.string(),
  value: z.unknown(),
})
export type Setting = z.infer<typeof Setting>
