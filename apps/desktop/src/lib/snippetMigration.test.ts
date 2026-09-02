import { beforeEach, describe, expect, it } from 'vitest'
import { DevDeskDB } from '@devdesk/database'
import { migrateLegacySnippets, snippetMarkdown } from './snippetMigration'

let db: DevDeskDB
const base = { workspaceId: 'w', userId: null, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }

beforeEach(async () => { db = new DevDeskDB(`snippet-migration-${crypto.randomUUID()}`); await db.open() })

describe('legacy snippet migration', () => {
  it('uses an unambiguous fence and is idempotent', async () => {
    expect(snippetMarkdown('bash', 'echo ```')).toContain('````bash')
    await db.snippets.put({ ...base, id: 's1', title: 'Command', code: 'echo ```', language: 'bash', tags: ['ops'], taskId: null })

    expect(await migrateLegacySnippets(db)).toBe(1)
    expect(await db.notes.get('s1')).toMatchObject({ title: 'Command', tags: ['ops'], body: '````bash\necho ```\n````' })
    expect((await db.snippets.get('s1'))?.deletedAt).not.toBeNull()
    expect(await migrateLegacySnippets(db)).toBe(0)
  })
})
