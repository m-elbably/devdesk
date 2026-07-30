import { describe, it, expect } from 'vitest'
import app from '../src/index'

const env = { JWT_SECRET: 'test-secret', DB: {} as D1Database }

describe('sync-api worker', () => {
  it('serves health without auth', async () => {
    const res = await app.request('/health', {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('rejects protected routes without a token', async () => {
    const res = await app.request('/api/sync/pull', {}, env)
    expect(res.status).toBe(401)
  })

  it('rejects auth/me without a token', async () => {
    const res = await app.request('/api/auth/me', {}, env)
    expect(res.status).toBe(401)
  })
})
