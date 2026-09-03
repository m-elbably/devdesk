/**
 * A `fetch`-shaped wrapper over Neutralino's native `net.request`.
 *
 * Why this exists: the packaged app is served from http://localhost:47821, so every
 * provider call is cross-origin. Some providers never send CORS headers — notably
 * api.openai.com — and a browser `fetch` to them can never succeed. Neutralino's
 * `net` module issues the request from C++, where CORS does not apply.
 *
 * The cost is that the native response is buffered (`body` is a string), so this
 * transport cannot stream. Callers use `generateText` rather than `streamText` on it.
 *
 * The `net.request` function is injected rather than imported so this package stays
 * free of `@neutralinojs/lib` and is testable in node — the same approach
 * `@devdesk/sync` takes with its transport.
 */

/**
 * The real shape of `net.request`'s options, taken from the framework's C++ source
 * (`api/net/net.cpp`) rather than the shipped typings, which are wrong twice over:
 * they omit `body`, `contentType` and `allowRedirects` entirely, and they type
 * `headers` as an array when the C++ iterates it as a key/value object.
 */
export interface NativeRequestOptions {
  headers?: Record<string, string>
  body?: string
  /** Defaults to application/json in the C++ when empty. */
  contentType?: string
  allowRedirects?: boolean
  timeout?: number
}

export interface NativeResponse {
  status: number
  statusText: string
  body: string
  headers?: Record<string, string> | Array<Record<string, string>>
  location?: string
}

export type NetRequestFn = (
  url: string,
  method?: string,
  options?: NativeRequestOptions,
) => Promise<NativeResponse>

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/** Normalise every header shape `RequestInit` allows into a plain object. */
function headersToObject(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  if (Array.isArray(init)) {
    for (const entry of init) {
      const [k, v] = entry as [string, string]
      if (k !== undefined) out[k] = v ?? ''
    }
    return out
  }
  if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  return { ...(init as Record<string, string>) }
}

/** The native response's headers come back as an object or a list of one-key objects. */
function toHeaders(raw: NativeResponse['headers']): Headers {
  const headers = new Headers()
  if (!raw) return headers
  const entries = Array.isArray(raw) ? raw.flatMap((h) => Object.entries(h)) : Object.entries(raw)
  for (const [key, value] of entries) {
    // Providers can repeat headers; `append` keeps them all rather than clobbering.
    try {
      headers.append(key, String(value))
    } catch {
      /* a malformed header name from the server must not sink the whole response */
    }
  }
  return headers
}

/**
 * Build a `fetch` implementation backed by `netRequest`.
 *
 * Deliberately unsupported, because the native bridge cannot express them:
 * streaming request bodies (anything that isn't a string), and `AbortSignal`
 * — `net.request` has no cancellation. An already-aborted signal is honoured
 * up front so callers at least fail fast.
 */
export function createNativeFetch(netRequest: NetRequestFn): typeof globalThis.fetch {
  const nativeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = headersToObject(init?.headers)

    let body: string | undefined
    if (init?.body != null) {
      if (typeof init.body !== 'string') {
        throw new TypeError(
          'The native transport can only send string request bodies. ' +
            'This is a provider issuing a streamed or binary body; use the fetch transport for it.',
        )
      }
      body = init.body
    }

    // The C++ defaults an empty contentType to application/json, but being explicit
    // keeps a provider that cares (some reject a mismatched type) from guessing.
    const contentType = headers['content-type'] ?? headers['Content-Type']

    const res = await netRequest(urlOf(input), method, {
      headers,
      ...(body === undefined ? {} : { body }),
      ...(contentType === undefined ? {} : { contentType }),
    })

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: toHeaders(res.headers),
    })
  }

  return nativeFetch as typeof globalThis.fetch
}

/**
 * True when a failed `fetch` looks like the browser refusing a cross-origin request.
 *
 * A CORS rejection is deliberately opaque — the browser reports a bare `TypeError`
 * with no detail, indistinguishable from the host being down. That ambiguity is why
 * the fallback only *tries* the native transport rather than concluding anything.
 */
export function looksLikeCorsFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('cors')
  )
}
