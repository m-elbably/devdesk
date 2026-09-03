import { describe, expect, it, vi } from 'vitest'
import type { NativeResponse, NetRequestFn } from './native-fetch'
import { baseUrlFor, createFallbackFetch, createModel, explainProviderError, listModels, resolveTransport } from './models'
import { configFromPreset } from './presets'
import type { ProviderConfig } from './types'

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  ...configFromPreset('lmstudio', 'p1'),
  ...over,
})

const corsError = () => new TypeError('Failed to fetch')

type FetchArgs = Parameters<typeof globalThis.fetch>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const nativeOk = (body: unknown): NetRequestFn =>
  vi.fn<NetRequestFn>(async (): Promise<NativeResponse> => ({
    status: 200,
    statusText: 'OK',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))

describe('resolveTransport', () => {
  it('uses plain fetch when there is no native bridge — the browser dev server', () => {
    const transport = resolveTransport({ transport: 'auto' })
    expect(transport.kind).toBe('fetch')
    expect(transport.canStream).toBe(true)
  })

  it('honours an explicit fetch choice even when the bridge is available', () => {
    const transport = resolveTransport({ transport: 'fetch' }, { netRequest: nativeOk({}) })
    expect(transport.kind).toBe('fetch')
    expect(transport.canStream).toBe(true)
  })

  it('cannot stream once the native bridge carries the request', () => {
    const transport = resolveTransport({ transport: 'native' }, { netRequest: nativeOk({}) })
    expect(transport.kind).toBe('native')
    expect(transport.canStream).toBe(false)
    expect(transport.fetch).toBeTypeOf('function')
  })

  it('refuses "native" in the browser rather than silently downgrading a deliberate choice', () => {
    expect(() => resolveTransport({ transport: 'native' })).toThrow(/only available in the desktop app/i)
  })
})

describe('createFallbackFetch', () => {
  it('does not touch the bridge while plain fetch works', async () => {
    const primary = vi.fn(async (..._args: FetchArgs) => jsonResponse({ ok: true }))
    const native = vi.fn(async (..._args: FetchArgs) => jsonResponse({ from: 'native' }))
    const fetchImpl = createFallbackFetch(primary as never, native as never)

    await fetchImpl('https://x/')
    await fetchImpl('https://x/')

    expect(primary).toHaveBeenCalledTimes(2)
    expect(native).not.toHaveBeenCalled()
  })

  it('retries through the bridge when the browser refuses the request', async () => {
    const primary = vi.fn(async () => {
      throw corsError()
    })
    const native = vi.fn(async (..._args: FetchArgs) => jsonResponse({ from: 'native' }))
    const onFallback = vi.fn()
    const fetchImpl = createFallbackFetch(primary as never, native as never, onFallback)

    expect(await (await fetchImpl('https://x/')).json()).toEqual({ from: 'native' })
    expect(onFallback).toHaveBeenCalledOnce()
  })

  it('remembers the fallback, so every later call skips the doomed attempt', async () => {
    const primary = vi.fn(async () => {
      throw corsError()
    })
    const native = vi.fn(async (..._args: FetchArgs) => jsonResponse({ from: 'native' }))
    const onFallback = vi.fn()
    const fetchImpl = createFallbackFetch(primary as never, native as never, onFallback)

    await fetchImpl('https://x/')
    await fetchImpl('https://x/')
    await fetchImpl('https://x/')

    expect(primary).toHaveBeenCalledTimes(1)
    expect(native).toHaveBeenCalledTimes(3)
    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('does not switch on an error that is not a transport refusal', async () => {
    const primary = vi.fn(async () => {
      throw new Error('provider exploded')
    })
    const native = vi.fn(async (..._args: FetchArgs) => jsonResponse({}))
    const fetchImpl = createFallbackFetch(primary as never, native as never)

    await expect(fetchImpl('https://x/')).rejects.toThrow('provider exploded')
    expect(native).not.toHaveBeenCalled()
  })

  it('reports the original failure when the bridge fails too', async () => {
    // "LM Studio is not running" is the likelier story than anything the bridge says,
    // and burying it under a secondary error sends the user hunting the wrong problem.
    const primary = vi.fn(async () => {
      throw corsError()
    })
    const native = vi.fn(async () => {
      throw new Error('bridge said no')
    })
    const fetchImpl = createFallbackFetch(primary as never, native as never)

    await expect(fetchImpl('https://x/')).rejects.toThrow('Failed to fetch')
  })

  it('does not stick to the bridge when the bridge itself failed', async () => {
    const primary = vi.fn(async () => {
      throw corsError()
    })
    const native = vi.fn(async () => {
      throw new Error('bridge said no')
    })
    const fetchImpl = createFallbackFetch(primary as never, native as never)

    await expect(fetchImpl('https://x/')).rejects.toThrow()
    await expect(fetchImpl('https://x/')).rejects.toThrow()
    expect(primary).toHaveBeenCalledTimes(2)
  })
})

describe('baseUrlFor', () => {
  it('falls back to the preset when the field is blank', () => {
    expect(baseUrlFor({ kind: 'ollama', baseUrl: '  ' })).toBe('http://localhost:11434/v1')
  })

  it('trims trailing slashes so URLs never double up', () => {
    expect(baseUrlFor({ kind: 'custom', baseUrl: 'http://box.local:8080/v1//' })).toBe('http://box.local:8080/v1')
  })

  it('insists on a URL for a custom provider, which has no preset to fall back on', () => {
    expect(() => baseUrlFor({ kind: 'custom', baseUrl: '' })).toThrow(/needs a base URL/i)
  })
})

describe('createModel', () => {
  it('builds an OpenAI-compatible model for every provider but Gemini', () => {
    for (const kind of ['lmstudio', 'ollama', 'deepseek', 'openai'] as const) {
      const { model } = createModel(provider({ kind, baseUrl: '' }), 'some-model')
      expect(model, kind).toBeDefined()
    }
  })

  it('builds a Gemini model through its own provider', () => {
    const config = provider({ kind: 'gemini', baseUrl: '', apiKey: 'k' })
    expect(createModel(config, 'gemini-2.0-flash').model).toBeDefined()
  })

  it('refuses to send a turn with no model chosen', () => {
    expect(() => createModel(provider(), '  ')).toThrow(/select a model/i)
  })

  it('hands the resolved transport to the provider, so the bridge is actually used', async () => {
    const netRequest = nativeOk({ data: [] })
    const { transport } = createModel(provider({ transport: 'native' }), 'm', { netRequest })
    expect(transport.canStream).toBe(false)
  })
})

describe('listModels', () => {
  it('reads an OpenAI-compatible model list', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      jsonResponse({ data: [{ id: 'qwen2.5-coder', owned_by: 'lmstudio' }, { id: 'llama3' }] }),
    )
    const models = await listModels(provider(), { fetchImpl: fetchImpl as never })

    expect(models).toEqual([{ id: 'llama3' }, { id: 'qwen2.5-coder', ownedBy: 'lmstudio' }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://localhost:1234/v1/models')
  })

  it('sends no Authorization header when there is no key to send', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => jsonResponse({ data: [] }))
    await listModels(provider({ apiKey: '' }), { fetchImpl: fetchImpl as never })
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({})
  })

  it('authenticates when a key is set', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => jsonResponse({ data: [] }))
    await listModels(provider({ kind: 'openai', baseUrl: '', apiKey: 'sk-test' }), {
      fetchImpl: fetchImpl as never,
    })
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('reads Gemini’s differently-shaped list and strips its "models/" prefix', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      jsonResponse({
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-legacy' },
        ],
      }),
    )
    const config = provider({ kind: 'gemini', baseUrl: '', apiKey: 'k' })
    const models = await listModels(config, { fetchImpl: fetchImpl as never })

    // The embedding model is dropped; the one that declares nothing is kept, since
    // silence from the server is not evidence the model is unusable.
    expect(models).toEqual([{ id: 'gemini-2.0-flash' }, { id: 'gemini-legacy' }])
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ 'x-goog-api-key': 'k' })
  })

  it('names the real problem for a rejected key', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => jsonResponse({ error: 'bad key' }, 401))
    await expect(
      listModels(provider({ kind: 'openai', baseUrl: '', apiKey: 'sk-bad' }), { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/rejected the API key/i)
  })

  it('points at the base URL when the endpoint is missing', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => new Response('not found', { status: 404 }))
    await expect(listModels(provider(), { fetchImpl: fetchImpl as never })).rejects.toThrow(/check the base url/i)
  })

  it('turns an opaque CORS refusal into the flag the user has to flip', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw corsError()
    })
    await expect(listModels(provider({ kind: 'ollama', baseUrl: '' }), { fetchImpl: fetchImpl as never })).rejects.toThrow(
      /OLLAMA_ORIGINS/,
    )
  })

  it('goes through the bridge when the browser refuses, and still returns the list', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw corsError()
    })
    const netRequest = nativeOk({ data: [{ id: 'gpt-4o' }] })
    const onNativeFallback = vi.fn()

    const models = await listModels(provider({ kind: 'openai', baseUrl: '', apiKey: 'sk' }), {
      fetchImpl: fetchImpl as never,
      netRequest,
      onNativeFallback,
    })

    expect(models).toEqual([{ id: 'gpt-4o' }])
    expect(onNativeFallback).toHaveBeenCalledOnce()
  })
})

describe('explainProviderError', () => {
  it('passes a real error through untouched', () => {
    expect(explainProviderError(new Error('rate limited'), PROVIDER)).toBe('rate limited')
  })

  it('explains the opaque one, with the provider-specific fix', () => {
    const message = explainProviderError(corsError(), { kind: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' })
    expect(message).toContain('LM Studio')
    expect(message).toContain('http://localhost:1234/v1')
    expect(message).toMatch(/cors/i)
  })

  it('still says something useful for a provider with no hint', () => {
    const message = explainProviderError(corsError(), { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' })
    expect(message).toContain('Could not reach OpenAI')
  })
})

const PROVIDER = { kind: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' } as const
