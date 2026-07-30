import { describe, it, expect, beforeEach } from 'vitest'
import { sign } from 'hono/jwt'
import app from '../src/index'

// Just enough D1 to exercise the user table: rows in memory, dispatched on the
// handful of statements auth.ts and admin.ts actually issue.
interface Row {
  id: string
  email: string
  name: string
  role: string
  password_hash: string
  salt: string
  active: number
  created_at: string
}

function fakeDb(rows: Row[]) {
  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => run(sql, binds),
    ...run(sql, []),
  })

  function run(sql: string, binds: unknown[]) {
    const results = () => {
      if (sql.includes('INSERT INTO users')) {
        const [id, email, name, role, password_hash, salt, active, created_at] = binds as string[]
        if (rows.some((r) => r.email === email)) throw new Error('UNIQUE constraint failed: users.email')
        if (role === 'admin' && rows.some((r) => r.role === 'admin')) throw new Error('UNIQUE constraint failed')
        rows.push({ id, email, name, role, password_hash, salt, active: Number(active), created_at } as Row)
        return []
      }
      if (sql.startsWith('UPDATE users SET password_hash')) {
        const [password_hash, salt, id] = binds as [string, string, string]
        const row = rows.find((r) => r.id === id)
        if (row) Object.assign(row, { password_hash, salt })
        return row ? [row] : []
      }
      if (sql.startsWith('UPDATE users SET name')) {
        const [name, id] = binds as [string, string]
        const row = rows.find((r) => r.id === id)
        if (row) row.name = name
        return row ? [row] : []
      }
      if (sql.startsWith('UPDATE users SET active')) {
        const [active, id] = binds as [number, string]
        const row = rows.find((r) => r.id === id)
        if (row) row.active = Number(active)
        return row ? [row] : []
      }
      if (sql.includes("WHERE role = 'admin'")) return rows.filter((r) => r.role === 'admin')
      if (sql.includes('WHERE email = ?')) return rows.filter((r) => r.email === binds[0])
      if (sql.includes('WHERE id = ?')) return rows.filter((r) => r.id === binds[0])
      return rows
    }
    return {
      first: async () => results()[0] ?? null,
      all: async () => ({ results: results() }),
      run: async () => ({ meta: { changes: results().length } }),
    }
  }

  return { prepare } as unknown as D1Database
}

const JWT_SECRET = 'test-secret'
const ADMIN = { DEFAULT_ADMIN_USERNAME: 'root@example.com', DEFAULT_ADMIN_PASSWORD: 'supersecret' }

let rows: Row[]
let env: { JWT_SECRET: string; DB: D1Database; DEFAULT_ADMIN_USERNAME: string; DEFAULT_ADMIN_PASSWORD: string }

const login = (email: string, password: string) =>
  app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, env)

beforeEach(() => {
  rows = []
  env = { JWT_SECRET, DB: fakeDb(rows), ...ADMIN }
})

describe('default admin seeding', () => {
  it('creates the admin from env on first login, once', async () => {
    const res = await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ user: { email: ADMIN.DEFAULT_ADMIN_USERNAME, role: 'admin' } })

    await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)
    expect(rows.filter((r) => r.role === 'admin')).toHaveLength(1)
  })

  it('rejects a wrong password for the seeded admin', async () => {
    await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)
    expect((await login(ADMIN.DEFAULT_ADMIN_USERNAME, 'wrongpassword')).status).toBe(401)
  })

  it('does not register unknown emails on login', async () => {
    expect((await login('stranger@example.com', 'password123')).status).toBe(401)
    // The seeded admin is the only account the login path is ever allowed to create.
    expect(rows.map((r) => r.email)).toEqual([ADMIN.DEFAULT_ADMIN_USERNAME])
  })
})

describe('admin routes', () => {
  const authed = async (role: string, path: string, init: RequestInit = {}) => {
    // requireActive looks the caller up by id, so the synthetic caller needs a real row.
    if (!rows.some((r) => r.id === 'u1')) {
      rows.push({ id: 'u1', email: 'u@example.com', name: 'U', role, password_hash: '', salt: '', active: 1, created_at: '' })
    }
    const token = await sign({ sub: 'u1', email: 'u@example.com', role, exp: 2 ** 31 }, JWT_SECRET)
    return app.request(path, { ...init, headers: { Authorization: `Bearer ${token}` } }, env)
  }

  it('refuses non-admin callers', async () => {
    expect((await authed('user', '/api/admin/users')).status).toBe(403)
  })

  it('lets an admin create a user, always with the user role', async () => {
    const res = await authed('admin', '/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'dev@example.com', name: 'Dev', password: 'password123' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ user: { email: 'dev@example.com', role: 'user' } })
  })

  it('rejects a duplicate email', async () => {
    const body = JSON.stringify({ email: 'dev@example.com', name: 'Dev', password: 'password123' })
    await authed('admin', '/api/admin/users', { method: 'POST', body })
    expect((await authed('admin', '/api/admin/users', { method: 'POST', body })).status).toBe(409)
  })

  it('renames a user and 404s on an unknown id', async () => {
    const created = await authed('admin', '/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'dev@example.com', name: 'Dev', password: 'password123' }),
    })
    const { id } = ((await created.json()) as { user: { id: string } }).user
    expect((await authed('admin', `/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Devon' }) })).status).toBe(200)
    expect(rows.find((r) => r.id === id)?.name).toBe('Devon')
    expect((await authed('admin', '/api/admin/users/nope', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) })).status).toBe(404)
  })

  it('lets an admin disable and re-enable a user, blocking their requests while disabled', async () => {
    const created = await authed('admin', '/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'dev@example.com', name: 'Dev', password: 'password123' }),
    })
    const { id } = ((await created.json()) as { user: { id: string } }).user

    expect((await authed('admin', `/api/admin/users/${id}/active`, {
      method: 'POST',
      body: JSON.stringify({ active: false }),
    })).status).toBe(200)
    expect((await login('dev@example.com', 'password123')).status).toBe(403)

    expect((await authed('admin', `/api/admin/users/${id}/active`, {
      method: 'POST',
      body: JSON.stringify({ active: true }),
    })).status).toBe(200)
    expect((await login('dev@example.com', 'password123')).status).toBe(200)
  })

  it('rejects an already-issued token once the account is disabled', async () => {
    const created = await authed('admin', '/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'dev@example.com', name: 'Dev', password: 'password123' }),
    })
    const { id } = ((await created.json()) as { user: { id: string } }).user
    const token = await sign({ sub: id, email: 'dev@example.com', role: 'user', exp: 2 ** 31 }, JWT_SECRET)
    const asDev = () => app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)

    expect((await asDev()).status).toBe(200)
    await authed('admin', `/api/admin/users/${id}/active`, { method: 'POST', body: JSON.stringify({ active: false }) })
    expect((await asDev()).status).toBe(403)
  })

  it('refuses to disable the administrator account', async () => {
    await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)
    const adminId = rows[0]!.id
    const res = await authed('admin', `/api/admin/users/${adminId}/active`, {
      method: 'POST',
      body: JSON.stringify({ active: false }),
    })
    expect(res.status).toBe(400)
  })

  it('resets a password so the old one stops working', async () => {
    await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)
    const id = rows[0]!.id
    const res = await authed('admin', `/api/admin/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password: 'brand-new-pass' }),
    })
    expect(res.status).toBe(200)
    expect((await login(ADMIN.DEFAULT_ADMIN_USERNAME, ADMIN.DEFAULT_ADMIN_PASSWORD)).status).toBe(401)
    expect((await login(ADMIN.DEFAULT_ADMIN_USERNAME, 'brand-new-pass')).status).toBe(200)
  })
})
