import { describe, it, expect, beforeEach } from 'vitest'
import { DevDeskDB, exportBackup, importBackup } from './db'

let db: DevDeskDB

beforeEach(async () => {
  db = new DevDeskDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

describe('exportBackup / importBackup', () => {
  it('round-trips table contents', async () => {
    await db.notes.put({ id: 'n1', title: 'Hello', content: 'World' } as never)
    await db.tasks.put({ id: 't1', title: 'Ship it', status: 'todo' } as never)

    const json = await exportBackup(db)

    const restored = new DevDeskDB(`test-${crypto.randomUUID()}`)
    await restored.open()
    await importBackup(json, restored)

    expect(await restored.notes.get('n1')).toMatchObject({ title: 'Hello' })
    expect(await restored.tasks.get('t1')).toMatchObject({ title: 'Ship it' })
  })

  it('overwrites matching ids but leaves others alone', async () => {
    await db.notes.put({ id: 'n1', title: 'Original' } as never)
    const json = await exportBackup(db)

    await db.notes.put({ id: 'n1', title: 'Edited after export' } as never)
    await db.notes.put({ id: 'n2', title: 'Added after export' } as never)

    await importBackup(json, db)

    expect((await db.notes.get('n1'))?.title).toBe('Original')
    expect((await db.notes.get('n2'))?.title).toBe('Added after export')
  })

  it('rejects a file that is not a backup', async () => {
    await expect(importBackup(JSON.stringify({ hello: 'world' }), db)).rejects.toThrow()
  })
})
