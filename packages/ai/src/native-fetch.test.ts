import { describe, expect, it, vi } from 'vitest'
import { createNativeFetch, looksLikeCorsFailure } from './native-fetch'
import type { NativeResponse, NetRequestFn } from './native-fetch'

const ok = (overrides: Partial<NativeResponse> = {}): NativeResponse => ({
  status: 200,
  statusText: 'OK',
  body: '{"ok":true}',
  ...overrides,
})

function stubNet(response: NativeResponse = ok()) {
  const netRequest = vi.fn<NetRequestFn>(async () => response)
  return { netRequest, fetch: createNativeFetch(netRequest) }
}

describe('createNativeFetch', () => {
  it('returns a real Response', async () => {
    const { fetch } = stubNet(ok({ status: 201, statusText: 'Created', body: '{"id":1}' }))
    const res = await fetch('https://api.example.com/v1/chat')

    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(201)
    expect(res.statusText).toBe('Created')
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ id: 1 })
  })

  it('reports a non-2xx as a response, not a throw — same as fetch', async () => {
    const { fetch } = stubNet(ok({ status: 401, statusText: 'Unauthorized', body: 'nope' }))
    const res = await fetch('https://api.example.com/v1/models')

    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('nope')
  })

  it('passes method, headers and body through to the bridge', async () => {
    const { netRequest, fetch } = stubNet()
    await fetch('https://api.example.com/v1/chat', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
      body: '{"model":"gpt-4"}',
    })

    expect(netRequest).toHaveBeenCalledWith('https://api.example.com/v1/chat', 'POST', {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
      body: '{"model":"gpt-4"}',
      contentType: 'application/json',
    })
  })

  it('accepts every input and header shape fetch does', async () => {
    const { netRequest, fetch } = stubNet()

    await fetch(new URL('https://api.example.com/a'))
    expect(netRequest.mock.calls[0]?.[0]).toBe('https://api.example.com/a')

    await fetch(new Request('https://api.example.com/b'))
    expect(netRequest.mock.calls[1]?.[0]).toBe('https://api.example.com/b')

    await fetch('https://api.example.com/c', { headers: new Headers({ 'X-Key': 'v' }) })
    expect(netRequest.mock.calls[2]?.[2]?.headers).toEqual({ 'x-key': 'v' })

    await fetch('https://api.example.com/d', { headers: [['X-Pair', 'v']] })
    expect(netRequest.mock.calls[3]?.[2]?.headers).toEqual({ 'X-Pair': 'v' })
  })

  it('defaults to GET and sends no body', async () => {
    const { netRequest, fetch } = stubNet()
    await fetch('https://api.example.com/v1/models')

    const [, method, options] = netRequest.mock.calls[0] ?? []
    expect(method).toBe('GET')
    expect(options).not.toHaveProperty('body')
    expect(options).not.toHaveProperty('contentType')
  })

  it('normalises response headers from either shape the bridge returns', async () => {
    const asObject = createNativeFetch(async () => ok({ headers: { 'content-type': 'application/json' } }))
    expect((await asObject('https://x/')).headers.get('content-type')).toBe('application/json')

    const asArray = createNativeFetch(async () => ok({ headers: [{ 'content-type': 'text/plain' }] }))
    expect((await asArray('https://x/')).headers.get('content-type')).toBe('text/plain')

    // With no headers from the bridge, Response supplies its own default rather
    // than none — the point is only that the missing field is not fatal.
    const absent = createNativeFetch(async () => ok())
    const res = await absent('https://x/')
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('x-anything')).toBeNull()
  })

  it('survives a malformed header name rather than losing the whole response', async () => {
    const { fetch } = stubNet(ok({ headers: { 'bad header': 'x', 'x-good': 'y' } }))
    const res = await fetch('https://x/')

    expect(res.headers.get('x-good')).toBe('y')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('refuses a non-string body with an explanation, since the bridge cannot carry one', async () => {
    const { fetch } = stubNet()
    await expect(fetch('https://x/', { method: 'POST', body: new Uint8Array([1, 2]) })).rejects.toThrow(
      /native transport can only send string request bodies/i,
    )
  })

  it('honours an already-aborted signal instead of issuing an uncancellable request', async () => {
    const { netRequest, fetch } = stubNet()
    const controller = new AbortController()
    controller.abort()

    await expect(fetch('https://x/', { signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(netRequest).not.toHaveBeenCalled()
  })

  it('parses a buffered SSE body, which is how a stream survives this transport', async () => {
    // net.request returns the whole response at once. The chunks still arrive in
    // order and parse normally — they just all arrive at the end.
    const sse = 'data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n'
    const { fetch } = stubNet(ok({ body: sse, headers: { 'content-type': 'text/event-stream' } }))
    const res = await fetch('https://x/', { method: 'POST', body: '{}' })

    expect(res.body).toBeInstanceOf(ReadableStream)
    expect(await res.text()).toBe(sse)
  })
})

describe('looksLikeCorsFailure', () => {
  it('recognises the opaque TypeError browsers report a blocked request as', () => {
    expect(looksLikeCorsFailure(new TypeError('Failed to fetch'))).toBe(true) // Chromium
    expect(looksLikeCorsFailure(new TypeError('Load failed'))).toBe(true) // WebKit
    expect(looksLikeCorsFailure(new TypeError('NetworkError when attempting to fetch'))).toBe(true) // Gecko
  })

  it('ignores errors that are plainly something else', () => {
    expect(looksLikeCorsFailure(new Error('Failed to fetch'))).toBe(false)
    expect(looksLikeCorsFailure(new TypeError('x is not a function'))).toBe(false)
    expect(looksLikeCorsFailure('Failed to fetch')).toBe(false)
    expect(looksLikeCorsFailure(undefined)).toBe(false)
  })
})
