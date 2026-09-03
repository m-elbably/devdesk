import { beforeEach, describe, expect, it } from 'vitest'
import { DevDeskDB, exportBackup, importBackup } from './db'
import { createRepositories, type Repositories } from './repositories'

let db: DevDeskDB
let repos: Repositories

const provider = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  kind: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-super-secret-key',
  model: 'gpt-4o',
  transport: 'auto',
  redact: true,
  ...over,
})

beforeEach(async () => {
  db = new DevDeskDB(`test-${crypto.randomUUID()}`)
  await db.open()
  repos = createRepositories(db)
})

describe('the AI tables are local-only', () => {
  it('exists at schema version 4', async () => {
    // v3 is the notebooks release. Reusing that number would leave two schemas
    // claiming one version, and installs already on 3 would never run this upgrade.
    expect(db.verno).toBe(4)
    expect(db.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['aiProviders', 'aiConversations']))
  })

  it('keeps the notebooks store the previous version introduced', async () => {
    // The v4 store map restates every table; dropping one here would delete it.
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['workspaces', 'tasks', 'notes', 'notebooks', 'snippets', 'settings', 'syncQueue']),
    )
  })

  it('writes nothing to the sync queue', async () => {
    // The point of not extending BaseRepository: synced entities enqueue on write.
    await repos.aiProviders.save(provider())
    await repos.aiConversations.save({ id: 'c1', title: 'Chat', messages: [], providerId: 'p1', model: 'gpt-4o' })

    expect(await db.syncQueue.count()).toBe(0)
  })

  it('keeps API keys out of the settings table, which is synced', async () => {
    await repos.aiProviders.save(provider())
    expect(await db.settings.count()).toBe(0)
  })
})

describe('AiProviderRepository', () => {
  it('round-trips a provider', async () => {
    const saved = await repos.aiProviders.save(provider())
    expect(saved.apiKey).toBe('sk-super-secret-key')
    expect(saved.createdAt).toBeTruthy()
    expect(await repos.aiProviders.get('p1')).toMatchObject({ label: 'OpenAI' })
    expect(await repos.aiProviders.list()).toHaveLength(1)
  })

  it('keeps the original createdAt across edits', async () => {
    const first = await repos.aiProviders.save(provider())
    const second = await repos.aiProviders.save(provider({ label: 'Renamed' }))

    expect(second.createdAt).toBe(first.createdAt)
    expect(second.label).toBe('Renamed')
    expect(await repos.aiProviders.list()).toHaveLength(1)
  })

  it('really removes a provider, leaving no tombstone holding its key', async () => {
    await repos.aiProviders.save(provider())
    await repos.aiProviders.remove('p1')

    expect(await repos.aiProviders.get('p1')).toBeUndefined()
    expect(await db.aiProviders.count()).toBe(0)
  })
})

describe('AiConversationRepository', () => {
  it('round-trips a thread as one row', async () => {
    const messages = [
      { id: 'm1', role: 'user', text: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', text: 'hello', createdAt: '2026-01-01T00:00:01.000Z' },
    ]
    await repos.aiConversations.save({ id: 'c1', title: 'Chat', messages, providerId: 'p1', model: 'm' })

    expect((await repos.aiConversations.get('c1'))?.messages).toEqual(messages)
  })

  it('lists newest first', async () => {
    await repos.aiConversations.save({ id: 'c1', title: 'Older', messages: [], providerId: 'p', model: 'm' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await repos.aiConversations.save({ id: 'c2', title: 'Newer', messages: [], providerId: 'p', model: 'm' })

    expect((await repos.aiConversations.list()).map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('clears the lot', async () => {
    await repos.aiConversations.save({ id: 'c1', title: 'a', messages: [], providerId: 'p', model: 'm' })
    await repos.aiConversations.clear()
    expect(await repos.aiConversations.list()).toEqual([])
  })
})

describe('backup redaction', () => {
  it('never writes an API key into a backup file', async () => {
    await repos.aiProviders.save(provider())
    const json = await exportBackup(db)

    // Checked against the raw text, not the parsed shape: a backup is a file the
    // user copies around, and a key anywhere in it has leaked.
    expect(json).not.toContain('sk-super-secret-key')
  })

  it('keeps the rest of the provider, so a restore is still useful', async () => {
    await repos.aiProviders.save(provider())
    const restored = new DevDeskDB(`test-${crypto.randomUUID()}`)
    await restored.open()
    await importBackup(await exportBackup(db), restored)

    expect(await restored.aiProviders.get('p1')).toMatchObject({
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      // Emptied rather than dropped: the settings UI reads this as "needs a key".
      apiKey: '',
    })
  })

  it('leaves the live database untouched', async () => {
    await repos.aiProviders.save(provider())
    await exportBackup(db)

    expect((await repos.aiProviders.get('p1'))?.apiKey).toBe('sk-super-secret-key')
  })

  it('redacts every provider, not just the first', async () => {
    await repos.aiProviders.save(provider({ id: 'p1', apiKey: 'sk-one' }))
    await repos.aiProviders.save(provider({ id: 'p2', apiKey: 'sk-two' }))

    const json = await exportBackup(db)
    expect(json).not.toContain('sk-one')
    expect(json).not.toContain('sk-two')
  })

  it('does not disturb tables with nothing to redact', async () => {
    await db.notes.put({ id: 'n1', title: 'Hello' } as never)
    const parsed = JSON.parse(await exportBackup(db)) as { data: Record<string, unknown[]> }

    expect(parsed.data.notes).toEqual([{ id: 'n1', title: 'Hello' }])
  })
})
