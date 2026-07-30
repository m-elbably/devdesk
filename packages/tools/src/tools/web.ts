import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { relativeTime } from '@devdesk/utils'
import { metaFor } from '../catalog'

// Pasting a bare host ("example.com/p?a=1") is the common case and `new URL`
// rejects it. Assume https rather than making the user retype the scheme.
// The `//` is what makes a scheme detectable: `new URL` happily reads
// "example.com:8443/p" as scheme "example.com:" with path "8443/p", so an
// apparent scheme is only trusted with `//` behind it, or when it is one of the
// slash-less schemes that genuinely omit it.
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*:\/\/|(mailto|tel|data|urn|sms):)/i
function toUrl(raw: string): URL {
  const s = raw.trim()
  try {
    return new URL(HAS_SCHEME.test(s) ? s : `https://${s}`)
  } catch {
    throw new Error(`Not a valid URL: ${s}`)
  }
}

export const urlParser: ToolPlugin = {
  metadata: metaFor('url-parser'),
  schema: z.object({ url: z.string() }),
  run: (input) => {
    const { url } = z.object({ url: z.string() }).parse(input)
    const u = toUrl(url)
    // Flat key/value rows rather than nested JSON: every part is then one
    // copyable line, and repeated query keys each get their own row instead of
    // the last one silently winning.
    // mailto:/tel:/data: have no host, so `origin` is the string "null" and
    // hostname is empty — skip those rows rather than print placeholders.
    const out: Record<string, string> = {}
    if (u.origin !== 'null') out.Origin = u.origin
    out.Protocol = u.protocol.replace(':', '')
    if (u.username) out.Username = u.username
    if (u.password) out.Password = u.password
    if (u.hostname) out.Hostname = u.hostname
    const defaultPort = { 'https:': 443, 'http:': 80, 'ws:': 80, 'wss:': 443 }[u.protocol]
    if (u.port) out.Port = u.port
    else if (defaultPort) out.Port = `${defaultPort} (default)`
    out.Path = u.pathname
    // Repeated keys (?tag=a&tag=b) are numbered rather than collapsed — losing
    // one silently is exactly the bug you open a URL parser to find.
    for (const k of new Set(u.searchParams.keys())) {
      const values = u.searchParams.getAll(k)
      if (values.length === 1) out[`?${k}`] = values[0]!
      else values.forEach((v, i) => (out[`?${k} [${i + 1}]`] = v))
    }
    if (u.hash) out.Fragment = u.hash.slice(1)
    return out
  },
}

const basicAuthSchema = z.object({
  mode: z.enum(['encode', 'decode']).default('encode'),
  username: z.string().default(''),
  password: z.string().default(''),
  header: z.string().default(''),
})
export const basicAuth: ToolPlugin = {
  metadata: metaFor('basic-auth'),
  schema: basicAuthSchema,
  run: (input) => {
    const { mode, username, password, header } = basicAuthSchema.parse(input)
    if (mode === 'decode') {
      // Accepts the whole header line, just the scheme + token, or a bare token.
      const token = header.trim().replace(/^(Authorization:\s*)?(Basic\s+)?/i, '')
      let decoded: string
      try {
        decoded = atob(token)
      } catch {
        throw new Error('Not valid Base64 — paste the token from an Authorization: Basic header.')
      }
      const i = decoded.indexOf(':')
      if (i === -1) throw new Error('Decoded value has no ":" — this is not a Basic auth token.')
      return { Username: decoded.slice(0, i), Password: decoded.slice(i + 1), Decoded: decoded }
    }
    const token = btoa(`${username}:${password}`)
    return {
      Header: `Authorization: Basic ${token}`,
      Token: token,
      curl: `curl -u '${username}:${password}' https://example.com`,
    }
  },
}

const slugSchema = z.object({
  text: z.string(),
  separator: z.string().default('-'),
  case: z.enum(['lower', 'upper', 'preserve']).default('lower'),
  maxLength: z.number().default(0),
})
export const slugify: ToolPlugin = {
  metadata: metaFor('slugify'),
  schema: slugSchema,
  run: (input) => {
    const { text, separator, case: casing, maxLength } = slugSchema.parse(input)
    // Match the runs we want instead of replacing the ones we don't — that way
    // leading/trailing separators never appear and `separator` needs no escaping.
    const words = text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .match(/[a-zA-Z0-9]+/g)
    if (!words) {
      if (!text.trim()) return ''
      throw new Error('Nothing left after removing non-ASCII characters — slugs only keep a-z, 0-9.')
    }
    let slug = words.join(separator)
    if (casing === 'lower') slug = slug.toLowerCase()
    else if (casing === 'upper') slug = slug.toUpperCase()
    // Trim on a word boundary so the slug never ends mid-word or on a separator.
    if (maxLength > 0 && slug.length > maxLength) {
      slug = slug.slice(0, maxLength)
      const cut = separator ? slug.lastIndexOf(separator) : -1
      if (cut > 0) slug = slug.slice(0, cut)
    }
    return slug
  },
}

// Ordered: browsers impersonate each other, so the most specific marker wins.
// Safari reports its real version in `Version/`, not `Safari/`.
const BROWSERS: [RegExp, string, string][] = [
  [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge', 'Blink'],
  [/(?:OPR|Opera)\/([\d.]+)/, 'Opera', 'Blink'],
  [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet', 'Blink'],
  [/(?:Chrome|CriOS)\/([\d.]+)/, 'Chrome', 'Blink'],
  [/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox', 'Gecko'],
  [/Version\/([\d.]+)[^)]*Safari/, 'Safari', 'WebKit'],
]
const OSES: [RegExp, (m: RegExpMatchArray) => string][] = [
  // NT 10.0 covers both Windows 10 and 11 — the UA cannot tell them apart.
  [/Windows NT ([\d.]+)/, (m) => `Windows ${{ '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m[1]!] ?? `NT ${m[1]}`}`],
  [/Android ([\d.]+)/, (m) => `Android ${m[1]}`],
  [/(?:iPhone|CPU) OS ([\d_]+)/, (m) => `iOS ${m[1]!.replace(/_/g, '.')}`],
  [/Mac OS X ([\d_.]+)/, (m) => `macOS ${m[1]!.replace(/_/g, '.')}`],
  [/CrOS/, () => 'ChromeOS'],
  [/Linux/, () => 'Linux'],
]
const BOT = /(bot|crawler|spider|slurp|curl|wget|python-requests|okhttp|postman|insomnia|headless)/i

export const userAgent: ToolPlugin = {
  metadata: metaFor('user-agent'),
  schema: z.object({ ua: z.string() }),
  run: (input) => {
    const { ua } = z.object({ ua: z.string() }).parse(input)
    const bot = ua.match(BOT)
    const browser = BROWSERS.map(([re, name, engine]) => {
      const m = ua.match(re)
      return m ? { name, engine, version: m[1]! } : null
    }).find(Boolean)
    const os = OSES.map(([re, label]) => {
      const m = ua.match(re)
      return m ? label(m) : null
    }).find(Boolean)

    const out: Record<string, string> = {}
    if (bot) out.Bot = `Yes — matched "${bot[1]}"`
    out.Browser = browser ? `${browser.name} ${browser.version}` : 'Unknown'
    out.Engine = browser?.engine ?? 'Unknown'
    out.OS = os ?? 'Unknown'
    // iPadOS 13+ sends a desktop UA, so "Desktop" here can still be an iPad.
    out.Device = bot ? 'Bot / HTTP client' : /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : /iPad|Tablet/.test(ua) ? 'Tablet' : 'Desktop'
    return out
  },
}

// --- HTTP status reference ---
// [name, what it actually means] — the second half is the part you look a
// status code up for in the first place.
export const STATUS_CODES: Record<number, [string, string]> = {
  100: ['Continue', 'Headers received; the client should send the request body.'],
  101: ['Switching Protocols', 'Upgrading the connection, e.g. to WebSocket.'],
  103: ['Early Hints', 'Preload hints sent before the final response.'],
  200: ['OK', 'The request succeeded and the body holds the result.'],
  201: ['Created', 'A new resource exists; its URL is in the Location header.'],
  202: ['Accepted', 'Queued for processing — the work is not done yet.'],
  204: ['No Content', 'Succeeded with nothing to return. Common for DELETE and PUT.'],
  206: ['Partial Content', 'A byte range was returned, in reply to a Range header.'],
  301: ['Moved Permanently', 'Use the new URL from now on. Caches and search engines follow it.'],
  302: ['Found', 'Temporary redirect. Keep using the original URL.'],
  303: ['See Other', 'Redirect that always becomes a GET — the POST/redirect/GET pattern.'],
  304: ['Not Modified', 'The cached copy is still valid; no body is sent.'],
  307: ['Temporary Redirect', 'Like 302, but the method and body must be preserved.'],
  308: ['Permanent Redirect', 'Like 301, but the method and body must be preserved.'],
  400: ['Bad Request', 'The request is malformed — bad syntax, bad JSON, missing field.'],
  401: ['Unauthorized', 'Really "unauthenticated": no or invalid credentials. Sends WWW-Authenticate.'],
  402: ['Payment Required', 'Reserved; used by some APIs for billing or quota problems.'],
  403: ['Forbidden', 'Authenticated but not allowed. Re-authenticating will not help.'],
  404: ['Not Found', 'No resource at this URL. Also used to hide a resource from unauthorized users.'],
  405: ['Method Not Allowed', 'The URL exists but not for this verb. Sends an Allow header.'],
  406: ['Not Acceptable', 'Nothing matched the Accept header the client sent.'],
  408: ['Request Timeout', 'The client took too long to send the request.'],
  409: ['Conflict', 'The change clashes with current state — a duplicate, or a stale version.'],
  410: ['Gone', 'Deliberately removed and not coming back, unlike 404.'],
  412: ['Precondition Failed', 'An If-Match / If-Unmodified-Since guard did not hold.'],
  413: ['Payload Too Large', 'The body exceeds what the server accepts.'],
  415: ['Unsupported Media Type', 'Wrong Content-Type — e.g. sending JSON where a form was expected.'],
  418: ["I'm a teapot", 'An April Fools joke from RFC 2324. Some servers use it as a decoy.'],
  422: ['Unprocessable Entity', 'Syntax is fine but the values fail validation.'],
  423: ['Locked', 'The resource is locked by another operation.'],
  428: ['Precondition Required', 'The server demands a conditional request to avoid lost updates.'],
  429: ['Too Many Requests', 'Rate limited. Check Retry-After before retrying.'],
  431: ['Request Header Fields Too Large', 'Headers are too big — often an oversized cookie.'],
  451: ['Unavailable For Legal Reasons', 'Blocked by law, a court order, or censorship.'],
  500: ['Internal Server Error', 'An unhandled error on the server. The catch-all failure.'],
  501: ['Not Implemented', 'The server does not support this method at all.'],
  502: ['Bad Gateway', 'A proxy got an invalid response from upstream.'],
  503: ['Service Unavailable', 'Overloaded or down for maintenance. Usually temporary.'],
  504: ['Gateway Timeout', 'A proxy waited too long for an upstream response.'],
  505: ['HTTP Version Not Supported', 'The server refuses this HTTP version.'],
  507: ['Insufficient Storage', 'The server is out of space to complete the request.'],
  511: ['Network Authentication Required', 'A captive portal wants you to sign in first.'],
}
const STATUS_CLASS: Record<string, string> = {
  1: 'Informational',
  2: 'Success',
  3: 'Redirection',
  4: 'Client error',
  5: 'Server error',
}
export const httpStatus: ToolPlugin = {
  metadata: metaFor('http-status'),
  schema: z.object({ query: z.string().default('') }),
  run: (input) => {
    const { query } = z.object({ query: z.string().default('') }).parse(input)
    const q = query.trim().toLowerCase()
    // "4xx" / "5xx" filter a whole class. A numeric query matches the code only —
    // otherwise "404" also drags in every code whose description mentions 404.
    const classMatch = /^([1-5])xx$/.exec(q)
    const numeric = /^\d+$/.test(q)
    const out: Record<string, string> = {}
    for (const [code, [name, meaning]] of Object.entries(STATUS_CODES)) {
      const hit = classMatch
        ? code.startsWith(classMatch[1]!)
        : numeric
          ? code.startsWith(q)
          : !q || name.toLowerCase().includes(q) || meaning.toLowerCase().includes(q)
      if (hit) out[`${code} ${name}`] = `${STATUS_CLASS[code[0]!]} · ${meaning}`
    }
    return out
  },
}

// --- cURL converter ---

/**
 * Split a shell command the way a shell would: quotes group, backslash-newline
 * continues, everything else splits on whitespace. Not a full shell parser (no
 * expansion, no pipes) — a curl command pasted from docs or DevTools is the
 * whole target.
 */
export function tokenizeShell(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let quoted = false // so an explicit '' stays a token
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = null
      // Only double quotes honour escapes; inside '' a backslash is literal.
      else if (quote === '"' && c === '\\' && i + 1 < command.length) current += command[++i]
      else current += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      quoted = true
    } else if (c === '\\' && command[i + 1] === '\n') i++
    else if (/\s/.test(c)) {
      if (current || quoted) out.push(current)
      current = ''
      quoted = false
    } else current += c
  }
  if (quote) throw new Error('Unbalanced quote in the curl command.')
  if (current || quoted) out.push(current)
  return out
}

// Flags that consume the next token. Anything else starting with "-" is treated
// as a boolean switch and skipped, so an unknown flag can't swallow the URL.
const CURL_VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-ascii',
  '--data-binary', '--data-urlencode', '-u', '--user', '-A', '--user-agent', '-b',
  '--cookie', '-e', '--referer', '-o', '--output', '-m', '--max-time', '--url',
  '--connect-timeout', '-T', '--upload-file', '-F', '--form', '--retry', '-w', '--write-out',
])

interface CurlRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  user: string
  insecure: boolean
}

function parseCurl(command: string): CurlRequest {
  const tokens = tokenizeShell(command.trim().replace(/^\$\s+/, ''))
  if (!tokens.length) throw new Error('Paste a curl command.')
  if (tokens[0] !== 'curl') throw new Error('Command should start with "curl".')

  const req: CurlRequest = { method: '', url: '', headers: {}, body: '', user: '', insecure: false }
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!
    // --header=value is as valid as --header value.
    const eq = token.startsWith('--') ? token.indexOf('=') : -1
    const flag = eq === -1 ? token : token.slice(0, eq)
    const inlineValue = eq === -1 ? null : token.slice(eq + 1)
    const value = () => inlineValue ?? tokens[++i] ?? ''

    if (!token.startsWith('-')) {
      req.url ||= token
      continue
    }
    switch (flag) {
      case '-X': case '--request': req.method = value().toUpperCase(); break
      case '-H': case '--header': {
        const header = value()
        const colon = header.indexOf(':')
        if (colon > 0) req.headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim()
        break
      }
      case '-d': case '--data': case '--data-raw': case '--data-ascii':
      case '--data-binary': case '--data-urlencode':
        // Repeated -d flags concatenate into one form-encoded body, as curl does.
        req.body = req.body ? `${req.body}&${value()}` : value()
        break
      case '-u': case '--user': req.user = value(); break
      case '-A': case '--user-agent': req.headers['User-Agent'] = value(); break
      case '-b': case '--cookie': req.headers.Cookie = value(); break
      case '-e': case '--referer': req.headers.Referer = value(); break
      case '--url': req.url = value(); break
      case '-k': case '--insecure': req.insecure = true; break
      default:
        if (CURL_VALUE_FLAGS.has(flag)) value() // consume and discard (-o, -m, …)
    }
  }
  if (!req.url) throw new Error('No URL found in the curl command.')
  req.method ||= req.body ? 'POST' : 'GET'
  return req
}

/** `{"a":1}` bodies read far better re-indented than as one escaped string. */
function jsBody(body: string, indent: string): string {
  try {
    const pretty = JSON.stringify(JSON.parse(body), null, 2).replace(/\n/g, `\n${indent}`)
    return `JSON.stringify(${pretty})`
  } catch {
    return JSON.stringify(body)
  }
}

function basicHeader(user: string): string {
  return `Basic ${btoa(user)}`
}

function toFetch(req: CurlRequest): string {
  const headers = { ...req.headers }
  if (req.user) headers.Authorization = basicHeader(req.user)
  const options = [`method: ${JSON.stringify(req.method)}`]
  if (Object.keys(headers).length) {
    const entries = Object.entries(headers).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    options.push(`headers: {\n${entries.join('\n')}\n  }`)
  }
  if (req.body) options.push(`body: ${jsBody(req.body, '  ')}`)
  return [
    `const response = await fetch(${JSON.stringify(req.url)}, {`,
    options.map((o) => `  ${o},`).join('\n'),
    `})`,
    ``,
    `if (!response.ok) throw new Error(\`HTTP \${response.status}\`)`,
    `const data = await response.json()`,
  ].join('\n')
}

function toAxios(req: CurlRequest): string {
  const options = [`method: ${JSON.stringify(req.method.toLowerCase())}`, `url: ${JSON.stringify(req.url)}`]
  if (Object.keys(req.headers).length) {
    const entries = Object.entries(req.headers).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    options.push(`headers: {\n${entries.join('\n')}\n  }`)
  }
  if (req.user) {
    const colon = req.user.indexOf(':')
    const username = colon === -1 ? req.user : req.user.slice(0, colon)
    const password = colon === -1 ? '' : req.user.slice(colon + 1)
    options.push(`auth: { username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} }`)
  }
  if (req.body) options.push(`data: ${jsBody(req.body, '  ')}`)
  return `const { data } = await axios({\n${options.map((o) => `  ${o},`).join('\n')}\n})`
}

function toHttpie(req: CurlRequest): string {
  const parts = ['http', req.method, quoteShell(req.url)]
  for (const [k, v] of Object.entries(req.headers)) parts.push(quoteShell(`${k}:${v}`))
  if (req.user) parts.push(`-a ${quoteShell(req.user)}`)
  if (req.body) parts.push(`--raw=${quoteShell(req.body)}`)
  if (req.insecure) parts.push('--verify=no')
  return parts.join(' ')
}

/** Single-quote for a POSIX shell; the only character that needs care is `'`. */
function quoteShell(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

const curlSchema = z.object({ command: z.string(), target: z.enum(['fetch', 'axios', 'httpie']).default('fetch') })
export const curlConverter: ToolPlugin = {
  metadata: metaFor('curl-converter'),
  schema: curlSchema,
  run: (input) => {
    const { command, target } = curlSchema.parse(input)
    if (!command.trim()) return ''
    const req = parseCurl(command)
    if (target === 'axios') return toAxios(req)
    if (target === 'httpie') return toHttpie(req)
    return toFetch(req)
  },
}

// --- Cookie inspector ---

const COOKIE_ATTRS = new Set(['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite', 'partitioned', 'priority'])

/** "1 hour", "2.5 days" — max-age and stale-* windows read as time, not integers. */
export function humanSeconds(seconds: number): string {
  if (seconds === 0) return '0 seconds (immediately stale)'
  const units: [number, string][] = [
    [31_536_000, 'year'], [2_592_000, 'month'], [604_800, 'week'],
    [86_400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second'],
  ]
  const [size, name] = units.find(([u]) => Math.abs(seconds) >= u) ?? units[units.length - 1]!
  const n = Math.round((seconds / size) * 10) / 10
  return `${n} ${name}${n === 1 ? '' : 's'}`
}

export const cookieParser: ToolPlugin = {
  metadata: metaFor('cookie-parser'),
  schema: z.object({ cookie: z.string() }),
  run: (input) => {
    const { cookie } = z.object({ cookie: z.string() }).parse(input)
    const text = cookie.trim().replace(/^(set-)?cookie:\s*/i, '')
    if (!text) return {}
    const parts = text.split(';').map((p) => p.trim()).filter(Boolean)
    const split = (part: string): [string, string] => {
      const eq = part.indexOf('=')
      return eq === -1 ? [part, ''] : [part.slice(0, eq).trim(), part.slice(eq + 1).trim()]
    }

    // A request `Cookie:` header is many name=value pairs with no attributes; a
    // `Set-Cookie:` is one pair followed by attributes. Tell them apart by
    // looking for a known attribute rather than asking the user which it is.
    const isSetCookie = parts.length === 1 || parts.slice(1).some((p) => COOKIE_ATTRS.has(split(p)[0].toLowerCase()))
    if (!isSetCookie) {
      const out: Record<string, string> = {}
      for (const part of parts) {
        const [name, value] = split(part)
        out[name] = value
      }
      return out
    }

    const [name, value] = split(parts[0]!)
    const attrs = new Map(parts.slice(1).map((p) => { const [k, v] = split(p); return [k.toLowerCase(), v] as const }))
    const out: Record<string, string> = { Name: name, Value: value }
    if (attrs.has('domain')) out.Domain = attrs.get('domain')!
    out.Path = attrs.get('path') || '/ (default)'

    const maxAge = attrs.get('max-age')
    if (maxAge !== undefined) {
      const seconds = Number(maxAge)
      out['Max-Age'] = Number.isFinite(seconds) ? `${maxAge} — ${humanSeconds(seconds)}` : maxAge
    }
    const expires = attrs.get('expires')
    if (expires !== undefined) {
      const at = Date.parse(expires)
      out.Expires = Number.isNaN(at) ? `${expires} (unparseable)` : `${new Date(at).toISOString()} — ${relativeTime(at / 1000)}`
    }
    // Max-Age wins over Expires wherever both are present.
    out.Lifetime = maxAge !== undefined || expires !== undefined ? 'Persistent' : 'Session — cleared when the browser closes'

    const sameSite = attrs.get('samesite')
    if (sameSite) out.SameSite = sameSite
    for (const flag of ['secure', 'httponly', 'partitioned'] as const) {
      if (attrs.has(flag)) out[flag === 'httponly' ? 'HttpOnly' : flag[0]!.toUpperCase() + flag.slice(1)] = 'Yes'
    }
    if (attrs.has('priority')) out.Priority = attrs.get('priority')!

    // Security review, since a cookie's flags are exactly what gets forgotten.
    if (!attrs.has('secure')) out['⚠ Secure'] = 'Missing — this cookie is sent over plain HTTP and can be read in transit.'
    if (!attrs.has('httponly')) out['⚠ HttpOnly'] = 'Missing — JavaScript can read this cookie, so an XSS bug can steal it.'
    if (!sameSite) out['⚠ SameSite'] = 'Not set — browsers default to Lax, but set it explicitly so behaviour is not left to the browser.'
    else if (sameSite.toLowerCase() === 'none' && !attrs.has('secure')) out['⚠ SameSite=None'] = 'SameSite=None requires Secure — browsers reject this cookie outright.'
    if (name.startsWith('__Host-') && (attrs.has('domain') || (attrs.get('path') ?? '/') !== '/' || !attrs.has('secure'))) {
      out['⚠ __Host- prefix'] = 'The __Host- prefix requires Secure, Path=/, and no Domain — this cookie will be rejected.'
    }
    return out
  },
}

// --- Cache-Control explainer ---

// [explanation, takes a value?]
const CACHE_DIRECTIVES: Record<string, [string, boolean]> = {
  'max-age': ['Fresh for %s. After that a cache must revalidate before reusing it.', true],
  's-maxage': ['Shared caches (CDNs, proxies) keep it fresh for %s, overriding max-age for them only.', true],
  'stale-while-revalidate': ['For %s past expiry a cache may serve the stale copy while it refreshes in the background.', true],
  'stale-if-error': ['If the origin errors, a cache may serve the stale copy for %s.', true],
  'max-stale': ['The client accepts a response stale by up to %s.', true],
  'min-fresh': ['The client wants a response that stays fresh for at least %s.', true],
  'no-cache': ['Cacheable, but never reused without revalidating with the origin first. Not the same as no-store.', false],
  'no-store': ['Never written to any cache, on disk or in memory. For responses with personal or secret data.', false],
  'no-transform': ['Proxies must not recompress images or otherwise alter the payload.', false],
  'must-revalidate': ['Once stale, a cache must revalidate — serving the stale copy is forbidden, even offline.', false],
  'proxy-revalidate': ['Like must-revalidate, but applies to shared caches only.', false],
  'must-understand': ['Only cache this if you understand the status code; otherwise treat it as no-store.', false],
  public: ['Any cache may store it, including CDNs and proxies — even if the request was authenticated.', false],
  private: ['Only the browser may store it. Shared caches (CDNs, proxies) must not.', false],
  immutable: ['The body will never change while fresh, so browsers skip revalidation on reload. For hashed asset URLs.', false],
  'only-if-cached': ['The client wants a cached copy only, and no origin request.', false],
}

export const cacheControl: ToolPlugin = {
  metadata: metaFor('cache-control'),
  schema: z.object({ value: z.string() }),
  run: (input) => {
    const { value } = z.object({ value: z.string() }).parse(input)
    const text = value.trim().replace(/^cache-control:\s*/i, '')
    if (!text) return {}
    const out: Record<string, string> = {}
    const seen = new Set<string>()
    for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
      const eq = part.indexOf('=')
      const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase()
      const raw = eq === -1 ? '' : part.slice(eq + 1).trim().replace(/^"|"$/g, '')
      seen.add(name)
      const known = CACHE_DIRECTIVES[name]
      if (!known) {
        out[part] = 'Unknown directive — caches ignore anything they do not recognise.'
        continue
      }
      const [template, takesValue] = known
      const seconds = Number(raw)
      if (takesValue && !Number.isFinite(seconds)) {
        out[part] = `${name} needs a value in seconds, e.g. ${name}=3600.`
        continue
      }
      out[eq === -1 ? name : `${name}=${raw}`] = template.replace('%s', takesValue ? humanSeconds(seconds) : '')
    }

    // Contradictions a header review is supposed to catch.
    if (seen.has('no-store') && (seen.has('max-age') || seen.has('public') || seen.has('s-maxage'))) {
      out['⚠ Conflict'] = 'no-store overrides the caching directives beside it — nothing here will be stored.'
    }
    if (seen.has('public') && seen.has('private')) out['⚠ Conflict'] = 'public and private contradict each other; caches will pick one unpredictably.'
    if (seen.has('immutable') && !seen.has('max-age')) out['⚠ immutable'] = 'immutable does nothing without a max-age to be immutable *for*.'
    if (!seen.size) out.Result = 'No directives found.'
    return out
  },
}

export const webTools = [urlParser, basicAuth, slugify, userAgent, httpStatus, curlConverter, cookieParser, cacheControl]
