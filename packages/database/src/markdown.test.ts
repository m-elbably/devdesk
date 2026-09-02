import { describe, expect, it } from 'vitest'
import { exportWorkspaceMarkdown } from './markdown'

const record = { workspaceId: 'w', userId: null, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }

describe('exportWorkspaceMarkdown', () => {
  it('writes portable task, note and snippet sections', () => {
    const output = exportWorkspaceMarkdown(
      { ...record, id: 'w', name: 'API', isDefault: false, home: { toolIds: [], noteIds: [], snippetIds: [] } },
      [{ ...record, id: 't', title: 'Ship', description: 'Deploy it', status: 'todo', priority: 'high', tags: ['release'], dueDate: null, position: 0 }],
      [{ ...record, id: 'n', title: 'Runbook', body: 'Rollback steps', tags: [], taskId: null }],
      [{ ...record, id: 's', title: 'Health check', code: 'curl /health', language: 'bash', tags: [], taskId: null }],
    )
    expect(output).toContain('# API')
    expect(output).toContain('- [ ] Ship (todo, high) — #release')
    expect(output).toContain('## Notes')
    expect(output).toContain('```bash\ncurl /health\n```')
  })
})
