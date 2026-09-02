import type { Note, Snippet, Task } from '@devdesk/shared'

export interface WorkspaceActivity {
  id: string
  title: string
  kind: 'Task' | 'Note' | 'Snippet'
  to: '/board' | '/notes' | '/snippets'
  updatedAt: string
}

export function recentWorkspaceActivity(tasks: Task[], notes: Note[], snippets: Snippet[]): WorkspaceActivity[] {
  return [
    ...tasks.map((task) => ({ id: task.id, title: task.title, kind: 'Task' as const, to: '/board' as const, updatedAt: task.updatedAt })),
    ...notes.map((note) => ({ id: note.id, title: note.title || 'Untitled note', kind: 'Note' as const, to: '/notes' as const, updatedAt: note.updatedAt })),
    ...snippets.map((snippet) => ({ id: snippet.id, title: snippet.title || 'Untitled snippet', kind: 'Snippet' as const, to: '/snippets' as const, updatedAt: snippet.updatedAt })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
}
