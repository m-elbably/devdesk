import { describe, it, expect, beforeEach } from 'vitest'
import { DevDeskDB, createRepositories } from '@devdesk/database'
import { createServices } from './index'
import { bus } from '@/lib/events'
import { lockVault, unlockNote } from '@/lib/vault'

// Service-layer integration: services orchestrate repositories AND announce mutations.
let services: ReturnType<typeof createServices>
let repos: ReturnType<typeof createRepositories>

beforeEach(async () => {
  const db = new DevDeskDB(`svc-${crypto.randomUUID()}`)
  await db.open()
  repos = createRepositories(db)
  services = createServices(repos)
  lockVault()
})

describe('task service', () => {
  it('persists a created task and emits a mutation event', async () => {
    const events: string[] = []
    const off = bus.on('entity:mutated', (e) => events.push(`${e.kind}:${e.op}`))

    const task = await services.tasks.create({ title: 'Ship' } as never)
    expect(await services.tasks.get(task.id)).toMatchObject({ title: 'Ship' })
    expect(events).toContain('task:upsert')
    off()
  })

  it('gives tasks created outside the board visible board defaults', async () => {
    const task = await services.tasks.create({ title: 'Captured task' } as never)
    expect(task).toMatchObject({ status: 'todo', priority: 'medium', tags: [], dueDate: null, position: 0 })
  })

  it('moves a task to a new column and position', async () => {
    const task = await services.tasks.create({ title: 'Move me', status: 'todo' } as never)
    await services.tasks.move(task.id, 'backlog', 3)
    const moved = await services.tasks.get(task.id)
    expect(moved).toMatchObject({ status: 'backlog', position: 3 })
  })

  it('soft-deletes so the task drops out of listings', async () => {
    const task = await services.tasks.create({ title: 'Temp' } as never)
    await services.tasks.remove(task.id)
    expect(await services.tasks.list()).toHaveLength(0)
  })
})

describe('notebook service', () => {
  it('reparents children and notes when a notebook is deleted', async () => {
    const parent = await services.notebooks.create({ name: 'Parent' } as never)
    const child = await services.notebooks.create({ name: 'Child', parentId: parent.id } as never)
    const note = await services.notes.create({ title: 'Stored', notebookId: parent.id } as never)

    await services.notebooks.remove(parent.id)

    expect(await services.notebooks.get(child.id)).toMatchObject({ parentId: null })
    expect(await services.notes.get(note.id)).toMatchObject({ notebookId: null })
  })
})

describe('note protection', () => {
  it('never exposes an encrypted note while the vault is locked', async () => {
    const stored = await repos.notes.create({
      title: 'Secret', body: 'must not render', tags: [], taskId: null, notebookId: null,
      isProtected: false, encrypted: { version: 2, keyHash: 'other-key', iv: 'iv', ciphertext: 'ciphertext' },
    } as never)

    await expect(services.notes.get(stored.id)).resolves.toMatchObject({ title: 'Protected note', body: '' })
  })

  it('changes a protected note key after the current key unlocks it', async () => {
    const created = await services.notes.create({ title: 'Secret', body: 'private' } as never)
    await services.notes.protect(created.id, 'old passphrase')
    const protectedRecord = await repos.notes.getWithDeleted(created.id)
    if (!protectedRecord?.encrypted) throw new Error('protected note was not stored')

    lockVault()
    await expect(services.notes.changeKey(created.id, 'new passphrase')).rejects.toThrow('Unlock this note')
    await unlockNote(protectedRecord, 'old passphrase')
    await services.notes.changeKey(created.id, 'new passphrase')

    lockVault()
    const rekeyed = await repos.notes.getWithDeleted(created.id)
    if (!rekeyed?.encrypted) throw new Error('rekeyed note was not stored')
    await expect(services.notes.get(created.id)).resolves.toMatchObject({ title: 'Protected note', body: '' })
    await unlockNote(rekeyed, 'new passphrase')
    await expect(services.notes.get(created.id)).resolves.toMatchObject({ title: 'Secret', body: 'private' })
  })
})

describe('tool recipes', () => {
  it('keeps a named input preset with the tool history', async () => {
    await services.toolUsage.history.add({
      id: crypto.randomUUID(),
      toolId: 'hash',
      label: 'Release checksum',
      input: { text: 'build.tar.gz' },
      output: null,
      createdAt: new Date().toISOString(),
    })
    expect(await services.toolUsage.history.byTool('hash')).toMatchObject([{ label: 'Release checksum', input: { text: 'build.tar.gz' } }])
  })
})
