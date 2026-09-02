import { describe, expect, it } from 'vitest'
import { recentWorkspaceActivity } from './workspaceActivity'

describe('recentWorkspaceActivity', () => {
  it('combines project records newest first', () => {
    const record = { workspaceId: 'w', userId: null, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const items = recentWorkspaceActivity(
      [{ ...record, id: 'task', title: 'Ship', description: '', status: 'todo', priority: 'medium', tags: [], dueDate: null, position: 0, updatedAt: '2026-01-02T00:00:00.000Z' }],
      [{ ...record, id: 'note', title: 'Brief', body: '', tags: [], taskId: null, notebookId: null, isProtected: false, encrypted: null, updatedAt: '2026-01-03T00:00:00.000Z' }],
    )
    expect(items.map((item) => item.id)).toEqual(['note', 'task'])
  })
})
