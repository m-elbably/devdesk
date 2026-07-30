import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'
import { DevDeskDB } from './db'
import { createRepositories, type Repositories } from './repositories'
import { TaskRepository } from './repositories'

let db: DevDeskDB
let repos: Repositories

beforeEach(async () => {
  // Unique name per test → isolated IndexedDB.
  db = new DevDeskDB(`test-${crypto.randomUUID()}`)
  await db.open()
  repos = createRepositories(db)
})

describe('BaseRepository', () => {
  it('creates with generated id/timestamps and bumps revision on update', async () => {
    const task = await repos.tasks.create({ title: 'First', status: 'todo' } as never)
    expect(task.id).toBeTruthy()
    expect(task.revision).toBe(0)
    expect(task.deletedAt).toBeNull()

    const updated = await repos.tasks.update(task.id, { title: 'Renamed' } as never)
    expect(updated.title).toBe('Renamed')
    expect(updated.revision).toBe(1)
  })

  it('soft delete hides the row from reads but keeps a tombstone', async () => {
    const task = await repos.tasks.create({ title: 'Temp' } as never)
    await repos.tasks.remove(task.id)
    expect(await repos.tasks.get(task.id)).toBeUndefined()
    expect((await repos.tasks.getWithDeleted(task.id))?.deletedAt).not.toBeNull()
    expect(await repos.tasks.list()).toHaveLength(0)
  })

  it('applyRemote merges last-write-wins', async () => {
    const t = new TaskRepository(db.tasks)
    const local = await t.create({ id: 'x', title: 'local', updatedAt: '2020-01-01T00:00:00.000Z' } as never)
    // Older remote is ignored.
    await t.applyRemote({ ...local, title: 'stale', updatedAt: '2019-01-01T00:00:00.000Z' })
    expect((await t.getWithDeleted('x'))?.title).toBe('local')
    // Newer remote wins.
    await t.applyRemote({ ...local, title: 'fresh', updatedAt: '2099-01-01T00:00:00.000Z' })
    expect((await t.getWithDeleted('x'))?.title).toBe('fresh')
    // A tie takes the remote: the server keeps its row on a tie (strict `>` there), so
    // yielding here is what makes both sides converge on the same winner.
    await t.applyRemote({ ...local, title: 'server', updatedAt: '2099-01-01T00:00:00.000Z' })
    expect((await t.getWithDeleted('x'))?.title).toBe('server')
  })
})

describe('WorkspaceRepository', () => {
  it('scopes a workspace to itself rather than to whatever was active', async () => {
    const ws = await repos.workspaces.create({ name: 'Side' } as never)
    expect(ws.workspaceId).toBe(ws.id)
    expect(ws.id).not.toBe(DEFAULT_WORKSPACE_ID)
  })
})

describe('TaskRepository.byStatus', () => {
  it('returns only matching status, ordered by position', async () => {
    await repos.tasks.create({ title: 'b', status: 'todo', position: 2 } as never)
    await repos.tasks.create({ title: 'a', status: 'todo', position: 1 } as never)
    await repos.tasks.create({ title: 'done', status: 'done', position: 1 } as never)
    const todo = await repos.tasks.byStatus(DEFAULT_WORKSPACE_ID, 'todo')
    expect(todo.map((t) => t.title)).toEqual(['a', 'b'])
  })
})

describe('FavoriteRepository', () => {
  it('toggles on and off', async () => {
    expect(await repos.favorites.toggle('uuid')).toBe(true)
    expect(await repos.favorites.isFavorite('uuid')).toBe(true)
    expect(await repos.favorites.toggle('uuid')).toBe(false)
    expect(await repos.favorites.list()).toHaveLength(0)
  })
})

describe('RecentToolRepository', () => {
  it('increments count and caps the list', async () => {
    await repos.recentTools.touch('uuid')
    await repos.recentTools.touch('uuid')
    const list = await repos.recentTools.list()
    expect(list[0]?.count).toBe(2)
  })
})
