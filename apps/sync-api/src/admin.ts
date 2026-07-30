import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './index'
import { insertUser, publicUser, setActive, setPassword, type UserRow } from './auth'

export const adminRoutes = new Hono<{ Bindings: Env }>()

// The JWT itself is verified upstream in index.ts; this only gates on the claim.
adminRoutes.use('*', async (c, next) => {
  const { role } = c.get('jwtPayload') as { role?: string }
  if (role !== 'admin') return c.json({ error: 'Administrator access required' }, 403)
  await next()
})

const newUser = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
})
const password = z.object({ password: z.string().min(8) })
const name = z.object({ name: z.string().min(1) })
const active = z.object({ active: z.boolean() })

adminRoutes.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at').all<UserRow>()
  return c.json({ users: (results ?? []).map(publicUser) })
})

adminRoutes.post('/users', async (c) => {
  const body = newUser.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Email, name and an 8+ character password are required' }, 400)
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.data.email).first()) {
    return c.json({ error: 'That email already has an account' }, 409)
  }
  // Always 'user': the one admin comes from the env seed, and the partial unique
  // index on users(role) would reject a second one anyway.
  const user = await insertUser(c.env.DB, { ...body.data, role: 'user' })
  return c.json({ user: publicUser(user) }, 201)
})

adminRoutes.patch('/users/:id', async (c) => {
  const body = name.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Name is required' }, 400)
  const res = await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?')
    .bind(body.data.name, c.req.param('id'))
    .run()
  if (!res.meta.changes) return c.json({ error: 'User not found' }, 404)
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/password', async (c) => {
  const body = password.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const id = c.req.param('id')
  if (!(await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first())) {
    return c.json({ error: 'User not found' }, 404)
  }
  await setPassword(c.env.DB, id, body.data.password)
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/active', async (c) => {
  const body = active.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: '"active" must be a boolean' }, 400)
  const id = c.req.param('id')
  const target = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>()
  if (!target) return c.json({ error: 'User not found' }, 404)
  // The admin role is a database-enforced singleton — disabling it would lock everyone
  // (including this admin) out of Administration with no other account able to re-enable it.
  if (target.role === 'admin' && !body.data.active) {
    return c.json({ error: 'The administrator account cannot be disabled' }, 400)
  }
  await setActive(c.env.DB, id, body.data.active)
  return c.json({ ok: true })
})
