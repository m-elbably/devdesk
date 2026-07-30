import { describe, it, expect, beforeEach } from 'vitest'
import { db, createRepositories } from '@devdesk/database'
import { backfillQueue, normalizeServerUrl } from './sync'

// The server URL is a trust boundary: credentials are POSTed to whatever it points at.
describe('normalizeServerUrl', () => {
  it('accepts https and strips the trailing slash', () => {
    expect(normalizeServerUrl(' https://sync.example.com/ ')).toBe('https://sync.example.com')
  })

  it('keeps a path prefix so the API can be mounted under a subpath', () => {
    expect(normalizeServerUrl('https://example.com/devdesk')).toBe('https://example.com/devdesk')
  })

  it('allows plain http only on loopback, for the local wrangler dev server', () => {
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeServerUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
  })

  it('rejects http on any remote host', () => {
    expect(() => normalizeServerUrl('http://sync.example.com')).toThrow(/https/)
  })

  it('rejects a bare hostname with no scheme', () => {
    expect(() => normalizeServerUrl('sync.example.com')).toThrow(/full URL/)
  })
})

// Data created before the first sync has no queue entry, so it would only ever be
// pulled over, never pushed up.
describe('backfillQueue', () => {
  const repos = createRepositories()

  beforeEach(async () => {
    localStorage.clear()
    await Promise.all([db.syncQueue.clear(), db.workspaces.clear(), db.tasks.clear()])
  })

  it('queues pre-existing local records on the first sync', async () => {
    const ws = await repos.workspaces.create({ name: 'Local', color: null, icon: null } as never)
    const task = await repos.tasks.create({ workspaceId: ws.id, title: 'Local task' } as never)

    await backfillQueue()

    const queued = await db.syncQueue.toArray()
    expect(queued.map((o) => o.entityId).sort()).toEqual([ws.id, task.id].sort())
    expect(queued.every((o) => o.op === 'upsert')).toBe(true)
  })

  it('does nothing once a cursor exists, and never double-queues', async () => {
    await repos.workspaces.create({ name: 'Local', color: null, icon: null } as never)
    await backfillQueue()
    localStorage.setItem('devdesk.sync.cursor', '{}')
    await backfillQueue()

    expect(await db.syncQueue.count()).toBe(1)
  })
})
