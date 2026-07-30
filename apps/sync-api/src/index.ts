import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { authRoutes, requireActive } from './auth'
import { adminRoutes } from './admin'
import { syncRoutes } from './sync'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  /** Seeds the one admin account on first login. Unset = no seeding. */
  DEFAULT_ADMIN_USERNAME?: string
  DEFAULT_ADMIN_PASSWORD?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true, service: 'devdesk-sync-api' }))

// Protect authenticated routes: /api/auth/me and everything under /api/sync and /api/admin.
const protect = (c: { env: Env }, next: () => Promise<void>) =>
  jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' })(c as never, next)
app.use('/api/auth/me', protect, requireActive)
app.use('/api/sync/*', protect, requireActive)
app.use('/api/admin/*', protect, requireActive)

app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/sync', syncRoutes)

export default app
