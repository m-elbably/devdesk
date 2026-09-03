import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createNativeFetch, looksLikeCorsFailure } from './native-fetch'
import type { NetRequestFn } from './native-fetch'
import { PROVIDER_PRESETS } from './presets'
import type { ProviderConfig, ModelInfo, TransportKind } from './types'

export type FetchFn = typeof globalThis.fetch

export interface TransportOptions {
  /**
   * Neutralino's `net.request`, when running inside the desktop shell. Absent in a
   * plain browser (`pnpm dev:desktop`) and in tests, where only `fetch` exists.
   */
  netRequest?: NetRequestFn
  /** Overrides the global fetch. Tests inject one; production leaves it alone. */
  fetchImpl?: FetchFn
  /** Called the first time a request falls back to the native transport. */
  onNativeFallback?: (reason: unknown) => void
}

/** What actually carries a provider's traffic, once the config and the host agree. */
export interface ResolvedTransport {
  kind: Exclude<TransportKind, 'auto'>
  /** Passed to the provider factory. `undefined` means "use the platform fetch". */
  fetch: FetchFn | undefined
  /**
   * False once the native bridge is in play: `net.request` buffers the whole
   * response in C++, so tokens all arrive at the end rather than as they are
   * produced. The request still succeeds — only the drip-feed is lost.
   */
  canStream: boolean
}

/**
 * Try the webview's own fetch, fall back to the native bridge on what looks like
 * a CORS rejection.
 *
 * The ambiguity is unavoidable: a browser reports a blocked cross-origin request
 * as a bare `TypeError`, indistinguishable from the host being down. So this never
 * *concludes* CORS — it just tries the other transport once and lets the result
 * speak. If the native attempt fails too, the original error is what the user sees,
 * because "LM Studio isn't running" is the far likelier story and rethrowing the
 * native error would bury it.
 */
export function createFallbackFetch(
  primary: FetchFn,
  nativeFetch: FetchFn,
  onFallback?: (reason: unknown) => void,
): FetchFn {
  let useNative = false

  const fallbackFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (useNative) return await nativeFetch(input, init)

    try {
      return await primary(input, init)
    } catch (error) {
      if (!looksLikeCorsFailure(error)) throw error
      try {
        const res = await nativeFetch(input, init)
        // Only stick to native once it has actually worked.
        useNative = true
        onFallback?.(error)
        return res
      } catch {
        throw error
      }
    }
  }

  return fallbackFetch as FetchFn
}

/**
 * Decide how this provider's HTTP goes out.
 *
 * `auto` degrades to plain fetch when there is no native bridge — that is the
 * browser dev server, where the user simply has to enable CORS on their local
 * server. `native` without a bridge is a configuration error worth reporting
 * rather than silently downgrading, since the user picked it deliberately.
 */
export function resolveTransport(
  config: Pick<ProviderConfig, 'transport'>,
  options: TransportOptions = {},
): ResolvedTransport {
  const { netRequest, fetchImpl, onNativeFallback } = options
  const primary = fetchImpl ?? globalThis.fetch?.bind(globalThis)

  if (config.transport === 'native') {
    if (!netRequest) {
      throw new Error(
        'The native transport is only available in the desktop app. ' +
          'Switch this provider back to Automatic to use it in the browser.',
      )
    }
    return { kind: 'native', fetch: createNativeFetch(netRequest), canStream: false }
  }

  if (config.transport === 'fetch' || !netRequest) {
    return { kind: 'fetch', fetch: fetchImpl, canStream: true }
  }

  const nativeFetch = createNativeFetch(netRequest)
  return {
    kind: 'fetch',
    fetch: createFallbackFetch(primary, nativeFetch, onNativeFallback),
    // Optimistic: the fallback only engages if the direct call is refused, and the
    // caller learns about it through `onNativeFallback`.
    canStream: true,
  }
}

/**
 * Build the AI SDK model for a provider.
 *
 * Gemini gets its own factory because it is the one provider here that does not
 * speak the OpenAI wire format. Everything else — LM Studio, Ollama, DeepSeek,
 * OpenAI and any custom server — goes through `openai-compatible`, which is the
 * whole reason that list can grow without new code.
 */
export function createModel(
  config: ProviderConfig,
  modelId: string,
  options: TransportOptions = {},
): { model: LanguageModel; transport: ResolvedTransport } {
  const id = modelId.trim()
  if (id === '') throw new Error(`Select a model for ${config.label} before sending a message.`)

  const transport = resolveTransport(config, options)

  if (config.kind === 'gemini') {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseUrl.trim() === '' ? {} : { baseURL: config.baseUrl.trim() }),
      ...(transport.fetch ? { fetch: transport.fetch } : {}),
    })
    return { model: google(id), transport }
  }

  const baseURL = baseUrlFor(config)
  const provider = createOpenAICompatible({
    name: config.kind,
    baseURL,
    // Local servers need no key, but some OpenAI-compatible ones reject an absent
    // Authorization header outright, so send a placeholder rather than nothing.
    apiKey: config.apiKey === '' ? 'devdesk-local' : config.apiKey,
    ...(transport.fetch ? { fetch: transport.fetch } : {}),
  })
  return { model: provider(id), transport }
}

/** The configured base URL, or the preset's when the user left it blank. */
export function baseUrlFor(config: Pick<ProviderConfig, 'kind' | 'baseUrl'>): string {
  const trimmed = config.baseUrl.trim().replace(/\/+$/, '')
  if (trimmed !== '') return trimmed
  const preset = PROVIDER_PRESETS[config.kind].baseUrl
  if (preset === '') throw new Error('This provider needs a base URL.')
  return preset
}

interface OpenAIModelList {
  data?: Array<{ id?: unknown; owned_by?: unknown }>
}

interface GeminiModelList {
  models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>
}

/**
 * Ask a provider which models it has.
 *
 * Doubles as the connection test: a provider that answers this is reachable, its
 * key works, and the returned list is what the model dropdown is populated from.
 * Errors are rethrown through `explainProviderError` so the user gets "enable CORS
 * in LM Studio" instead of a bare `TypeError: Failed to fetch`.
 */
export async function listModels(config: ProviderConfig, options: TransportOptions = {}): Promise<ModelInfo[]> {
  const transport = resolveTransport(config, options)
  const doFetch = transport.fetch ?? globalThis.fetch.bind(globalThis)
  const base = baseUrlFor(config)

  try {
    if (config.kind === 'gemini') {
      const res = await doFetch(`${base}/models`, {
        headers: config.apiKey === '' ? {} : { 'x-goog-api-key': config.apiKey },
      })
      const body = (await readJson(res, config)) as GeminiModelList
      return (body.models ?? [])
        .filter((m) => {
          const methods = m.supportedGenerationMethods
          // Absent means the server didn't say; keep it rather than hide a usable model.
          return !Array.isArray(methods) || methods.includes('generateContent')
        })
        .map((m) => ({ id: String(m.name ?? '').replace(/^models\//, '') }))
        .filter((m) => m.id !== '')
    }

    const res = await doFetch(`${base}/models`, {
      headers: config.apiKey === '' ? {} : { Authorization: `Bearer ${config.apiKey}` },
    })
    const body = (await readJson(res, config)) as OpenAIModelList
    return (body.data ?? [])
      .map((m) => {
        const id = String(m.id ?? '')
        const ownedBy = typeof m.owned_by === 'string' ? m.owned_by : undefined
        return ownedBy === undefined ? { id } : { id, ownedBy }
      })
      .filter((m) => m.id !== '')
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    throw new Error(explainProviderError(error, config), { cause: error })
  }
}

async function readJson(res: Response, config: ProviderConfig): Promise<unknown> {
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(statusMessage(res.status, config) + (detail === '' ? '' : ` — ${detail}`))
  }
  return await res.json()
}

function statusMessage(status: number, config: ProviderConfig): string {
  if (status === 401 || status === 403) return `${config.label} rejected the API key (HTTP ${status}).`
  if (status === 404) return `${config.label} has no /models endpoint at this URL (HTTP 404). Check the base URL.`
  return `${config.label} returned HTTP ${status}.`
}

/**
 * Turn a transport failure into something the user can act on.
 *
 * The failure this exists for is a browser CORS refusal, which arrives as a bare
 * `TypeError` with no detail whatsoever. Left alone it reads as a bug in the app;
 * in practice it almost always means the local server needs one flag flipped, and
 * the presets already carry that exact instruction.
 */
export function explainProviderError(error: unknown, config: Pick<ProviderConfig, 'kind' | 'label' | 'baseUrl'>): string {
  if (!looksLikeCorsFailure(error)) {
    return error instanceof Error ? error.message : String(error)
  }

  const hint = PROVIDER_PRESETS[config.kind].hint
  const base = `Could not reach ${config.label} at ${config.baseUrl}. It may not be running, or it may be refusing requests from this app.`
  return hint === undefined ? base : `${base} ${hint}`
}
