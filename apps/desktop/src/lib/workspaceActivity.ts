import type { Note, Task } from '@devdesk/shared'

export interface WorkspaceActivity {
  id: string
  title: string
  kind: 'Task' | 'Note'
  to: '/board' | '/notes'
  updatedAt: string
}

export function recentWorkspaceActivity(tasks: Task[], notes: Note[]): WorkspaceActivity[] {
  return [
    ...tasks.map((task) => ({ id: task.id, title: task.title, kind: 'Task' as const, to: '/board' as const, updatedAt: task.updatedAt })),
    ...notes.map((note) => ({ id: note.id, title: note.title || 'Untitled note', kind: 'Note' as const, to: '/notes' as const, updatedAt: note.updatedAt })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
}
