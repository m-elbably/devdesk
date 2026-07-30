import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiClient } from './api-client'

afterEach(() => vi.unstubAllGlobals())

describe('ApiClient error messages', () => {
  it('surfaces the server\'s error field instead of the raw status + body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'Invalid credentials' }) }),
    )
    const client = new ApiClient('http://api.test')
    await expect(client.login('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })

  it('falls back to a generic message when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' }))
    const client = new ApiClient('http://api.test')
    await expect(client.login('a@b.com', 'x')).rejects.toThrow('Request failed (500)')
  })
})
