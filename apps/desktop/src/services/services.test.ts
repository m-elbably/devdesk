import { describe, it, expect, beforeEach } from 'vitest'
import { DevDeskDB, createRepositories } from '@devdesk/database'
import { createServices } from './index'
import { bus } from '@/lib/events'

// Service-layer integration: services orchestrate repositories AND announce mutations.
let services: ReturnType<typeof createServices>

beforeEach(async () => {
  const db = new DevDeskDB(`svc-${crypto.randomUUID()}`)
  await db.open()
  services = createServices(createRepositories(db))
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
