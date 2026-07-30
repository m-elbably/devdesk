import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { z } from 'zod'
import type { Context, Next } from 'hono'
import type { Env } from './index'

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

// PBKDF2-SHA256, 100k iterations. Never store or log the raw password.
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(bits)
}

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) })

export type UserRole = 'admin' | 'user'

export interface UserRow {
  id: string
  email: string
  name: string
  role: UserRole
  password_hash: string
  salt: string
  active: number
}

/** The user shape the client is allowed to see — never the hash or salt. */
export const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active })

/** Create a user with a fresh salt. Shared by admin seeding and admin-created accounts. New accounts start active. */
export async function insertUser(
  DB: D1Database,
  user: { email: string; name: string; role: UserRole; password: string },
): Promise<UserRow> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const row: UserRow = {
    id: crypto.randomUUID(),
    email: user.email,
    name: user.name,
    role: user.role,
    password_hash: await hashPassword(user.password, salt),
    salt: toHex(salt),
    active: 1,
  }
  await DB.prepare(
    'INSERT INTO users (id, email, name, role, password_hash, salt, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(row.id, row.email, row.name, row.role, row.password_hash, row.salt, row.active, new Date().toISOString())
    .run()
  return row
}

/** Enable/disable an account. A disabled user can neither log in nor use an existing token. */
export async function setActive(DB: D1Database, id: string, active: boolean): Promise<D1Result> {
  return DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run()
}

/** Re-derive a user's password hash from a new salt. */
export async function setPassword(DB: D1Database, id: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  await DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(await hashPassword(password, salt), toHex(salt), id)
    .run()
}

/**
 * Provision the single admin from DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD,
 * but only when no admin exists yet. Workers have no startup hook, so this runs on
 * login — it is a single indexed lookup once an admin is present.
 */
export async function ensureDefaultAdmin(env: Env): Promise<void> {
  const email = env.DEFAULT_ADMIN_USERNAME
  const password = env.DEFAULT_ADMIN_PASSWORD
  if (!email || !password) return
  if (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").first()) return
  // Loses the race against a concurrent seed (or an existing non-admin row with the
  // same email) on a unique index — either way an admin ends up existing exactly once.
  await insertUser(env.DB, { email, name: 'Administrator', role: 'admin', password }).catch(() => {})
}

export const authRoutes = new Hono<{ Bindings: Env }>()

authRoutes.post('/login', async (c) => {
  const body = credentials.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Invalid credentials' }, 400)
  const { email, password } = body.data

  await ensureDefaultAdmin(c.env)

  // ponytail: no register-on-login. Accounts come from the env-seeded admin or from
  // Administration → Users, so sync is not open to self-serve signup.
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>()
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const attempt = await hashPassword(password, fromHex(user.salt))
  if (attempt !== user.password_hash) return c.json({ error: 'Invalid credentials' }, 401)
  if (!user.active) return c.json({ error: 'This account has been disabled' }, 403)

  const token = await sign(
    { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 },
    c.env.JWT_SECRET,
  )
  return c.json({ token, user: publicUser(user) })
})

authRoutes.post('/logout', (c) => c.json({ ok: true })) // stateless: client drops the token

/**
 * Re-checks account status on every authenticated request — a disabled admin can't just
 * ride out a 30-day JWT. One indexed lookup per request, same cost as ensureDefaultAdmin.
 */
export async function requireActive(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const { sub } = c.get('jwtPayload') as { sub: string }
  const user = await c.env.DB.prepare('SELECT active FROM users WHERE id = ?').bind(sub).first<{ active: number }>()
  if (!user?.active) return c.json({ error: 'This account has been disabled' }, 403)
  await next()
}

// Read back from the database so a renamed user sees the new name without re-login.
authRoutes.get('/me', async (c) => {
  const { sub } = c.get('jwtPayload') as { sub: string }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(sub).first<UserRow>()
  if (!user) return c.json({ error: 'Unknown user' }, 401)
  return c.json({ user: publicUser(user) })
})
