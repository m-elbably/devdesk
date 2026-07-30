import { z } from 'zod'
import CryptoJS from 'crypto-js'
import type { ToolPlugin } from '@devdesk/shared'
import forge from 'node-forge'
import { relativeTime } from '@devdesk/utils'
import { metaFor } from '../catalog'
import { qrSvg } from './images'

const countSchema = z.object({ count: z.number().int().min(1).max(100).default(5) })

// --- UUID ---
// RFC 4122 predefined namespaces.
const NAMESPACES = {
  DNS: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  URL: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  OID: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  X500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
}

const uuidSchema = z.object({
  version: z.enum(['v1', 'v3', 'v4', 'v5']).default('v4'),
  count: z.number().int().min(1).max(100).default(5),
  namespace: z.enum(['DNS', 'URL', 'OID', 'X500']).default('DNS'),
  name: z.string().default(''),
})

const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')

// UUID v1: gregorian timestamp + random node. ponytail: no sub-ms counter; we
// bump the clock-seq each call so a batch is still distinct. Upgrade to a real
// 100ns counter only if strict v1 monotonicity matters.
const V1_NODE = crypto.getRandomValues(new Uint8Array(6))
V1_NODE[0] = V1_NODE[0]! | 0x01 // multicast bit marks a random (non-MAC) node
let v1Clock = crypto.getRandomValues(new Uint16Array(1))[0]! & 0x3fff
function uuidV1(): string {
  const GREG = 0x01b21dd213814000n // 100ns intervals from 1582-10-15 to 1970-01-01
  const ns = BigInt(Date.now()) * 10000n + GREG
  const timeLow = Number(ns & 0xffffffffn)
  const timeMid = Number((ns >> 32n) & 0xffffn)
  const timeHi = Number((ns >> 48n) & 0x0fffn) | 0x1000 // version
  v1Clock = (v1Clock + 1) & 0x3fff
  const clockHi = (v1Clock >> 8) | 0x80 // variant
  const clockLo = v1Clock & 0xff
  return `${hex(timeLow, 8)}-${hex(timeMid, 4)}-${hex(timeHi, 4)}-${hex(clockHi, 2)}${hex(clockLo, 2)}-${Array.from(V1_NODE, (b) => hex(b, 2)).join('')}`
}

function parseUuidBytes(uuid: string): Uint8Array {
  const h = uuid.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(h)) throw new Error('Invalid namespace UUID')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16))
}
function formatUuid(bytes: Uint8Array, version: number): string {
  const b = bytes.slice(0, 16)
  b[6] = (b[6]! & 0x0f) | (version << 4)
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => hex(x, 2)).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
// Name-based v3 (MD5) / v5 (SHA-1): hash(namespace bytes + name).
async function uuidNamed(version: 'v3' | 'v5', namespace: keyof typeof NAMESPACES, name: string): Promise<string> {
  const ns = parseUuidBytes(NAMESPACES[namespace])
  const nameBytes = new TextEncoder().encode(name)
  const data = new Uint8Array(ns.length + nameBytes.length)
  data.set(ns)
  data.set(nameBytes, ns.length)
  const hash = version === 'v5' ? new Uint8Array(await crypto.subtle.digest('SHA-1', data)) : md5(data)
  return formatUuid(hash, version === 'v5' ? 5 : 3)
}

export const uuidTool: ToolPlugin = {
  metadata: metaFor('uuid'),
  schema: uuidSchema,
  run: async (input) => {
    const { version, count, namespace, name } = uuidSchema.parse(input)
    if (version === 'v3' || version === 'v5') {
      // Deterministic: same namespace+name → same UUID, so the `count` copies are identical.
      const value = await uuidNamed(version, namespace, name)
      return Array.from({ length: count }, () => value)
    }
    const gen = version === 'v1' ? uuidV1 : () => crypto.randomUUID()
    return Array.from({ length: count }, gen)
  },
}

// ponytail: minimal MD5 (RFC 1321) — Web Crypto has no MD5 and it's only needed
// for name-based UUID v3. Replace with a lib only if we grow more MD5 callers.
function md5(input: Uint8Array): Uint8Array {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c))
  const s = Uint8Array.of(
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  )
  const K = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)
  const len = input.length
  const blocks = ((len + 8) >> 6) + 1
  const bytes = new Uint8Array(blocks * 64)
  bytes.set(input)
  bytes[len] = 0x80
  const dv = new DataView(bytes.buffer)
  const bitLen = len * 8
  dv.setUint32(blocks * 64 - 8, bitLen >>> 0, true)
  dv.setUint32(blocks * 64 - 4, Math.floor(bitLen / 2 ** 32), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(i * 64 + j * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let k = 0; k < 64; k++) {
      let F: number, g: number
      if (k < 16) { F = (B & C) | (~B & D); g = k }
      else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16 }
      else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * k) % 16 }
      F = (F + A + K[k]! + M[g]!) >>> 0
      A = D; D = C; C = B
      B = (B + rotl(F, s[k]!)) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true); odv.setUint32(8, c0, true); odv.setUint32(12, d0, true)
  return out
}

// --- ULID ---
// Crockford base32. ponytail: 16 random chars from bytes%32 (not bit-exact 80-bit)
// — valid-shaped, time-sortable ULIDs; swap for a spec-exact encoder if strict interop matters.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function encodeTime(now: number): string {
  let str = ''
  for (let i = 0; i < 10; i++) {
    str = CROCKFORD[now % 32] + str
    now = Math.floor(now / 32)
  }
  return str
}
function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => CROCKFORD[b % 32]).join('')
}
export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}

export const ulidTool: ToolPlugin = {
  metadata: metaFor('ulid'),
  schema: countSchema,
  run: (input) => {
    const { count } = countSchema.parse(input)
    return Array.from({ length: count }, () => ulid())
  },
}

// --- Hash (async via Web Crypto) ---
const hashSchema = z.object({
  text: z.string(),
  algorithm: z.enum(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']).default('SHA-256'),
})
export const hashTool: ToolPlugin = {
  metadata: metaFor('hash'),
  schema: hashSchema,
  run: async (input) => {
    const { text, algorithm } = hashSchema.parse(input)
    const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  },
}

// --- HMAC (crypto-js: supports MD5/SHA1/SHA3/SHA224/256/384/512 which Web Crypto lacks) ---
const HMAC_ALGOS = {
  MD5: (m: string, k: string) => CryptoJS.HmacMD5(m, k),
  SHA1: (m: string, k: string) => CryptoJS.HmacSHA1(m, k),
  SHA224: (m: string, k: string) => CryptoJS.HmacSHA224(m, k),
  SHA256: (m: string, k: string) => CryptoJS.HmacSHA256(m, k),
  SHA384: (m: string, k: string) => CryptoJS.HmacSHA384(m, k),
  SHA512: (m: string, k: string) => CryptoJS.HmacSHA512(m, k),
  // CryptoJS HmacSHA3 uses SHA3's default 512-bit output.
  SHA3: (m: string, k: string) => CryptoJS.HmacSHA3(m, k),
} as const
const hmacSchema = z.object({
  text: z.string(),
  secret: z.string().default(''),
  algorithm: z.enum(['MD5', 'SHA1', 'SHA224', 'SHA256', 'SHA384', 'SHA512', 'SHA3']).default('SHA256'),
  encoding: z.enum(['binary', 'hex', 'base64', 'base64url']).default('hex'),
})
export const hmacTool: ToolPlugin = {
  metadata: metaFor('hmac'),
  schema: hmacSchema,
  run: (input) => {
    const { text, secret, algorithm, encoding } = hmacSchema.parse(input)
    const mac = HMAC_ALGOS[algorithm](text, secret)
    switch (encoding) {
      case 'binary':
        return mac.toString(CryptoJS.enc.Latin1)
      case 'base64':
        return mac.toString(CryptoJS.enc.Base64)
      case 'base64url':
        return mac.toString(CryptoJS.enc.Base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      case 'hex':
      default:
        return mac.toString(CryptoJS.enc.Hex)
    }
  },
}

// --- TOTP / HOTP (RFC 6238 / RFC 4226, native Web Crypto HMAC) ---
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const base32Normalize = (input: string) => input.toUpperCase().replace(/[^A-Z2-7]/g, '')
function base32Decode(input: string): Uint8Array {
  const clean = base32Normalize(input)
  if (!clean) throw new Error('Enter a Base32 secret (e.g. JBSWY3DPEHPK3PXP)')
  let bits = ''
  for (const ch of clean) bits += BASE32_ALPHABET.indexOf(ch).toString(2).padStart(5, '0')
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  // Fewer than 8 bits (e.g. a 1-character secret) decodes to zero bytes — reject with a
  // clear message instead of letting Web Crypto fail on an empty HMAC key.
  if (bytes.length === 0) throw new Error('Base32 secret is too short — need at least 2 characters')
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return bytes
}
const OTP_HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' } as const
// Shared HOTP core (RFC 4226): TOTP is just HOTP with counter = floor(time / period).
async function hotpCode(key: Uint8Array, counter: bigint, algorithm: keyof typeof OTP_HASH, digits: number): Promise<string> {
  const counterBytes = new Uint8Array(8)
  new DataView(counterBytes.buffer).setBigUint64(0, counter, false)
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key).buffer, { name: 'HMAC', hash: OTP_HASH[algorithm] }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes))
  const offset = mac[mac.length - 1]! & 0x0f
  const binCode = ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16) | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff)
  return (binCode % 10 ** digits).toString().padStart(digits, '0')
}
const otpSchema = z.object({
  mode: z.enum(['TOTP', 'HOTP']).default('TOTP'),
  secret: z.string().default(''),
  algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']).default('SHA1'),
  digits: z.enum(['6', '8']).default('6'),
  period: z.number().int().min(5).max(300).default(30),
  counter: z.number().int().min(0).default(0),
  issuer: z.string().default(''),
  account: z.string().default(''),
})
export interface OtpResult {
  code: string
  secondsRemaining?: number
  period?: number
  counter?: number
  nextCounter?: number
  /** otpauth:// enrolment URI, plus its QR — scan to add the secret to a real authenticator app. */
  uri: string
  qr: string
}

// Key URI format (github.com/google/google-authenticator/wiki/Key-Uri-Format).
// The label is "Issuer:Account" and issuer is repeated as a parameter — apps read
// one or the other depending on age, so emit both.
function otpauthUri(o: z.infer<typeof otpSchema> & { secret: string }): string {
  const label = [o.issuer, o.account || 'DevDesk'].filter(Boolean).map(encodeURIComponent).join(':')
  const params = new URLSearchParams({ secret: o.secret, algorithm: o.algorithm, digits: o.digits })
  if (o.issuer) params.set('issuer', o.issuer)
  if (o.mode === 'HOTP') params.set('counter', String(o.counter))
  else params.set('period', String(o.period))
  return `otpauth://${o.mode.toLowerCase()}/${label}?${params}`
}

// TOTP re-runs every second so the code ticks over, but the enrolment URI only
// changes when a field does — memoise one entry rather than re-encoding a QR
// (the expensive part) 60× a minute.
let qrCacheUri = ''
let qrCacheSvg = ''
async function cachedQr(uri: string): Promise<string> {
  if (uri !== qrCacheUri) {
    qrCacheSvg = await qrSvg(uri)
    qrCacheUri = uri
  }
  return qrCacheSvg
}
export const totpHotpTool: ToolPlugin = {
  metadata: metaFor('totp-hotp'),
  schema: otpSchema,
  run: async (input): Promise<OtpResult> => {
    const opts = otpSchema.parse(input)
    const { mode, secret, algorithm, digits, period, counter } = opts
    if (!secret.trim()) throw new Error('Enter a Base32 secret (e.g. JBSWY3DPEHPK3PXP)')
    const key = base32Decode(secret)
    const numDigits = Number(digits)
    // Authenticator apps want the canonical Base32 — not whatever spacing/case was typed.
    const uri = otpauthUri({ ...opts, secret: base32Normalize(secret) })
    const qr = await cachedQr(uri)
    if (mode === 'HOTP') {
      const code = await hotpCode(key, BigInt(counter), algorithm, numDigits)
      return { code, counter, nextCounter: counter + 1, uri, qr }
    }
    const nowSeconds = Math.floor(Date.now() / 1000)
    const step = Math.floor(nowSeconds / period)
    const code = await hotpCode(key, BigInt(step), algorithm, numDigits)
    return { code, secondsRemaining: period - (nowSeconds % period), period, uri, qr }
  },
}

// --- Token ---
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?'
// Shared by Token's "custom" charset and the Password generator.
function customAlphabet(o: { uppercase: boolean; lowercase: boolean; digits: boolean; symbols: boolean }): string {
  let alphabet = ''
  if (o.uppercase) alphabet += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (o.lowercase) alphabet += 'abcdefghijklmnopqrstuvwxyz'
  if (o.digits) alphabet += '0123456789'
  if (o.symbols) alphabet += SYMBOLS
  return alphabet
}
const tokenSchema = z.object({
  length: z.number().int().min(4).max(256).default(32),
  charset: z.enum(['custom', 'hex', 'base64url', 'alphanumeric']).default('hex'),
  uppercase: z.boolean().default(true),
  lowercase: z.boolean().default(true),
  digits: z.boolean().default(true),
  symbols: z.boolean().default(false),
})
const CHARSETS = {
  hex: '0123456789abcdef',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
}
function randomFrom(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
export const tokenTool: ToolPlugin = {
  metadata: metaFor('token'),
  schema: tokenSchema,
  run: (input) => {
    const o = tokenSchema.parse(input)
    if (o.charset === 'custom') {
      const alphabet = customAlphabet(o)
      if (!alphabet) throw new Error('Select at least one character set')
      return randomFrom(alphabet, o.length)
    }
    return randomFrom(CHARSETS[o.charset], o.length)
  },
}

// --- Password ---
const pwSchema = z.object({
  length: z.number().int().min(6).max(128).default(20),
  uppercase: z.boolean().default(true),
  lowercase: z.boolean().default(true),
  digits: z.boolean().default(true),
  symbols: z.boolean().default(true),
})
export const passwordTool: ToolPlugin = {
  metadata: metaFor('password'),
  schema: pwSchema,
  run: (input) => {
    const o = pwSchema.parse(input)
    const alphabet = customAlphabet(o)
    if (!alphabet) throw new Error('Select at least one character set')
    return randomFrom(alphabet, o.length)
  },
}

// --- Password Strength ---
// Crack time is a brute-force estimate (guesses = charsetSize^length at an
// assumed 1e9 guesses/sec offline-attack rate), not a dictionary-attack model.
const GUESSES_PER_SECOND = 1e9
const CRACK_UNITS: [string, number][] = [
  ['century', 100 * 365.25 * 86400],
  ['year', 365.25 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]
function humanCrackTime(seconds: number): string {
  if (seconds < 1) return 'instantly'
  if (!Number.isFinite(seconds) || seconds > 1000 * CRACK_UNITS[0]![1]) return 'effectively uncrackable'
  let rem = Math.round(seconds)
  const parts: string[] = []
  for (const [label, size] of CRACK_UNITS) {
    if (rem >= size) {
      const n = Math.floor(rem / size)
      parts.push(`${n} ${label}${n === 1 ? '' : 's'}`)
      rem %= size
      if (parts.length === 2) break
    }
  }
  return parts.join(', ') || '0 seconds'
}
export interface PasswordAnalysis {
  length: number
  charsetSize: number
  entropy: number
  score: number
  crackSeconds: number
  crackTime: string
  hasLower: boolean
  hasUpper: boolean
  hasDigits: boolean
  hasSymbols: boolean
}
export function analyzePassword(password: string): PasswordAnalysis {
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigits = /[0-9]/.test(password)
  const hasSymbols = /[^a-zA-Z0-9]/.test(password)
  let charsetSize = 0
  if (hasLower) charsetSize += 26
  if (hasUpper) charsetSize += 26
  if (hasDigits) charsetSize += 10
  if (hasSymbols) charsetSize += SYMBOLS.length
  const entropy = password.length * Math.log2(charsetSize || 1)
  const score = Math.max(0, Math.min(100, Math.round((Math.min(entropy, 128) / 128) * 100)))
  const crackSeconds = Math.pow(10, password.length * Math.log10(charsetSize || 1) - Math.log10(GUESSES_PER_SECOND))
  return {
    length: password.length,
    charsetSize,
    entropy,
    score,
    crackSeconds,
    crackTime: humanCrackTime(crackSeconds),
    hasLower,
    hasUpper,
    hasDigits,
    hasSymbols,
  }
}
const pwStrengthSchema = z.object({ password: z.string().default('') })
export const passwordStrengthTool: ToolPlugin = {
  metadata: metaFor('password-strength'),
  schema: pwStrengthSchema,
  run: (input) => {
    const { password } = pwStrengthSchema.parse(input)
    if (!password) throw new Error('Enter a password to analyse')
    const a = analyzePassword(password)
    return {
      'Duration to crack (brute force)': a.crackTime,
      'Password length': a.length,
      Entropy: `${a.entropy.toFixed(2)} bits`,
      'Character set size': a.charsetSize,
      Score: `${a.score} / 100`,
    }
  },
}

// --- JWT parser ---
function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
export const jwtParser: ToolPlugin = {
  metadata: metaFor('jwt-parser'),
  schema: z.object({ token: z.string() }),
  run: (input) => {
    const { token } = z.object({ token: z.string() }).parse(input)
    const parts = token.trim().split('.')
    if (parts.length !== 3) throw new Error('Not a valid JWT (expected 3 dot-separated parts)')
    const [header, payload, signature] = parts
    return {
      header: JSON.parse(b64urlDecode(header!)),
      payload: JSON.parse(b64urlDecode(payload!)),
      signature,
    }
  },
}

// --- JWT signer (HMAC only) ---
// jwt-parser reads tokens; this mints them. HS* only: RS*/ES* need a private key
// and an asymmetric signer, which is a different tool, not another dropdown entry.
const JWT_HMAC = {
  HS256: (m: string, k: string) => CryptoJS.HmacSHA256(m, k),
  HS384: (m: string, k: string) => CryptoJS.HmacSHA384(m, k),
  HS512: (m: string, k: string) => CryptoJS.HmacSHA512(m, k),
} as const

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const jwtSignSchema = z.object({
  payload: z.string(),
  secret: z.string().default(''),
  algorithm: z.enum(['HS256', 'HS384', 'HS512']).default('HS256'),
  expiresIn: z.number().int().min(0).default(0),
})

export const jwtSigner: ToolPlugin = {
  metadata: metaFor('jwt-signer'),
  schema: jwtSignSchema,
  run: (input) => {
    const { payload, secret, algorithm, expiresIn } = jwtSignSchema.parse(input)
    let claims: Record<string, unknown>
    try {
      claims = JSON.parse(payload)
    } catch {
      throw new Error('Payload must be a JSON object, e.g. {"sub":"123","name":"Ada"}')
    }
    if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
      throw new Error('Payload must be a JSON object, not an array or primitive.')
    }
    if (!secret) throw new Error('Enter a secret — an unsigned token proves nothing.')
    // iat/exp are seconds since the epoch, not milliseconds (RFC 7519 §2). Only
    // fill them in when absent, so a payload that sets its own wins.
    const now = Math.floor(Date.now() / 1000)
    claims.iat ??= now
    if (expiresIn > 0) claims.exp ??= now + expiresIn
    const signingInput = `${b64urlEncode(JSON.stringify({ alg: algorithm, typ: 'JWT' }))}.${b64urlEncode(JSON.stringify(claims))}`
    const sig = JWT_HMAC[algorithm](signingInput, secret)
      .toString(CryptoJS.enc.Base64)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return `${signingInput}.${sig}`
  },
}

// --- Encrypt / Decrypt (crypto-js: passphrase-based, OpenSSL-compatible) ---
const CIPHERS = { AES: CryptoJS.AES, TripleDES: CryptoJS.TripleDES, Rabbit: CryptoJS.Rabbit, RC4: CryptoJS.RC4 }
const cipherSchema = z.object({
  text: z.string(),
  secret: z.string().default(''),
  algorithm: z.enum(['AES', 'TripleDES', 'Rabbit', 'RC4']).default('AES'),
  mode: z.enum(['encrypt', 'decrypt']).default('encrypt'),
})
export const encryptionTool: ToolPlugin = {
  metadata: metaFor('encryption'),
  schema: cipherSchema,
  run: (input) => {
    const { text, secret, algorithm, mode } = cipherSchema.parse(input)
    const cipher = CIPHERS[algorithm]
    if (mode === 'encrypt') return cipher.encrypt(text, secret).toString()
    const out = cipher.decrypt(text, secret).toString(CryptoJS.enc.Utf8)
    // Wrong secret/algorithm yields empty (or throws on malformed input) — surface a clear error.
    if (!out) throw new Error('Could not decrypt — check the algorithm and secret.')
    return out
  },
}

// --- RSA key pair (native Web Crypto, no keygen library needed) ---
// PKCS8/SPKI PEM ("BEGIN PRIVATE KEY", not "BEGIN RSA PRIVATE KEY") — the modern
// format every current tool (openssl, ssh, node, python) reads.
// Clamps rather than rejects — the number input's stepper/typing can easily land
// outside 256–16384 or off the multiple-of-8 grid, and silently snapping to the
// nearest valid size beats surfacing a raw validation error for a slider-like field.
const rsaBitsSchema = z.coerce
  .number()
  .int()
  .transform((b) => Math.round(Math.min(16384, Math.max(256, b)) / 8) * 8)
const rsaKeyPairSchema = z.object({ bits: rsaBitsSchema.default(2048) })

function toPem(buf: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

export const rsaKeyPairTool: ToolPlugin = {
  metadata: metaFor('rsa-keypair'),
  schema: rsaKeyPairSchema,
  run: async (input) => {
    const { bits } = rsaKeyPairSchema.parse(input)
    let keyPair: CryptoKeyPair
    try {
      keyPair = (await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
    } catch {
      // Crypto engines commonly refuse RSA keys under ~512 bits, and some cap the
      // top end well below the field's 16384 max — either way, fails fast rather
      // than hanging, so point at a size known to work instead of guessing which
      // bound was hit.
      throw new Error(`Could not generate a ${bits}-bit key — this engine doesn't support that size. Try 2048–4096 bits.`)
    }
    const [spki, pkcs8] = await Promise.all([
      crypto.subtle.exportKey('spki', keyPair.publicKey),
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    ])
    return { publicKey: toPem(spki, 'PUBLIC KEY'), privateKey: toPem(pkcs8, 'PRIVATE KEY') }
  },
}

// --- X.509 certificate inspector (node-forge: ASN.1/X.509 is not something to hand-roll) ---
const PEM_CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
const certSchema = z.object({ pem: z.string() })

// SAN entry types worth naming (RFC 5280 GeneralName tags). forge decodes the
// value for the common ones; the rest fall back to whatever it parsed.
const SAN_TYPES: Record<number, string> = { 1: 'email', 2: 'DNS', 6: 'URI', 7: 'IP' }
type ForgeAltName = { type: number; value?: string; ip?: string }
const formatAltName = (a: ForgeAltName) => `${SAN_TYPES[a.type] ?? `type ${a.type}`}:${a.ip ?? a.value ?? ''}`

// A distinguished name is a list of typed attributes ("CN=example.com, O=Example
// Inc"). forge types an attribute value as string | any[] — the array form is a
// multi-valued RDN, rare but legal.
const dnString = (attrs: forge.pki.CertificateField[]) =>
  attrs.map((a) => `${a.shortName ?? a.name}=${Array.isArray(a.value) ? a.value.join('+') : a.value}`).join(', ')

const hexColons = (hex: string) => (hex.toUpperCase().match(/.{2}/g) ?? []).join(':')

export const certParser: ToolPlugin = {
  metadata: metaFor('cert-parser'),
  schema: certSchema,
  run: (input) => {
    const { pem } = certSchema.parse(input)
    const blocks = pem.match(PEM_CERT_BLOCK)
    if (!blocks?.length) throw new Error('No certificate found — paste a PEM block starting with -----BEGIN CERTIFICATE-----')

    let cert: forge.pki.Certificate
    try {
      cert = forge.pki.certificateFromPem(blocks[0]!)
    } catch (e) {
      throw new Error(`Could not parse the certificate — ${e instanceof Error ? e.message : 'malformed PEM or DER'}`)
    }

    // Fingerprint the *original* DER, not a re-encode of the parsed object: a
    // round-trip can normalise bytes and silently produce a fingerprint that
    // doesn't match what openssl or a browser reports.
    const der = forge.util.decode64(blocks[0]!.replace(/-----[^-]+-----|\s/g, ''))
    const fingerprint = (md: forge.md.MessageDigest) => hexColons(md.update(der).digest().toHex())

    const { notBefore, notAfter } = cert.validity
    const now = Date.now()
    const status =
      now > notAfter.getTime()
        ? `EXPIRED ${relativeTime(notAfter.getTime() / 1000)}`
        : now < notBefore.getTime()
          ? `Not yet valid — starts ${relativeTime(notBefore.getTime() / 1000)}`
          : `Valid — expires ${relativeTime(notAfter.getTime() / 1000)}`

    const san = cert.extensions.find((e) => e.name === 'subjectAltName') as { altNames?: ForgeAltName[] } | undefined
    const basic = cert.extensions.find((e) => e.name === 'basicConstraints') as { cA?: boolean } | undefined
    const publicKey = cert.publicKey as { n?: { bitLength(): number } }
    const subject = dnString(cert.subject.attributes)
    const issuer = dnString(cert.issuer.attributes)

    return {
      Subject: subject,
      Issuer: issuer,
      Status: status,
      'Valid from': notBefore.toISOString(),
      'Valid to': notAfter.toISOString(),
      'Serial number': hexColons(cert.serialNumber),
      'Signature algorithm': forge.pki.oids[cert.siginfo.algorithmOid] ?? cert.siginfo.algorithmOid,
      'Public key': publicKey.n ? `RSA ${publicKey.n.bitLength()}-bit` : 'EC or non-RSA',
      'Subject alternative names': san?.altNames?.map(formatAltName).join(', ') ?? '(none)',
      'Certificate authority': basic?.cA ? 'Yes — this is a CA certificate' : 'No — end-entity certificate',
      'Self-signed': subject === issuer ? 'Yes' : 'No',
      'SHA-256 fingerprint': fingerprint(forge.md.sha256.create()),
      'SHA-1 fingerprint': fingerprint(forge.md.sha1.create()),
      // A pasted fullchain.pem is common; say which one is on screen rather than
      // silently showing the leaf.
      ...(blocks.length > 1 ? { Chain: `${blocks.length} certificates in this PEM — showing the first (leaf)` } : {}),
    }
  },
}

// --- UUID inspector ---
// The inverse of the generator: given a UUID, say which version made it and pull
// out what that version encodes. v1/v6 count 100-nanosecond intervals from the
// Gregorian epoch (1582-10-15); v7 is plain Unix milliseconds.
const uuidInspectSchema = z.object({ uuid: z.string() })

const GREGORIAN_OFFSET_MS = 12_219_292_800_000
const UUID_VERSIONS: Record<number, string> = {
  1: 'v1 — time-based (MAC + timestamp)',
  2: 'v2 — DCE security',
  3: 'v3 — name-based (MD5)',
  4: 'v4 — random',
  5: 'v5 — name-based (SHA-1)',
  6: 'v6 — reordered time-based',
  7: 'v7 — Unix-epoch time-ordered',
  8: 'v8 — vendor-specific',
}

function uuidVariant(nibble: number): string {
  if ((nibble & 0b1000) === 0) return 'NCS (reserved, legacy)'
  if ((nibble & 0b1100) === 0b1000) return 'RFC 4122 / 9562'
  if ((nibble & 0b1110) === 0b1100) return 'Microsoft (reserved)'
  return 'Reserved (future)'
}

export const uuidInspector: ToolPlugin = {
  metadata: metaFor('uuid-inspector'),
  schema: uuidInspectSchema,
  run: (input) => {
    // Accept the forms people actually paste: braced, urn-prefixed, or bare.
    const raw = uuidInspectSchema.parse(input).uuid.trim().replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      throw new Error('Not a UUID — expected 8-4-4-4-12 hexadecimal characters')
    }
    const hex = raw.replace(/-/g, '').toLowerCase()
    const canonical = raw.toLowerCase()

    if (hex === '0'.repeat(32)) return { Input: canonical, Version: 'Nil UUID (all zero bits)', Variant: 'n/a' }
    if (hex === 'f'.repeat(32)) return { Input: canonical, Version: 'Max UUID (all one bits)', Variant: 'n/a' }

    const version = Number.parseInt(hex[12]!, 16)
    const out: Record<string, string> = {
      Input: canonical,
      Version: UUID_VERSIONS[version] ?? `Unknown (${version})`,
      Variant: uuidVariant(Number.parseInt(hex[16]!, 16)),
    }

    if (version === 1 || version === 6) {
      // v1 scatters the timestamp low-mid-high; v6 stores it already in order.
      const intervals =
        version === 1
          ? (BigInt(`0x${hex.slice(12, 16)}`) & 0x0fffn) << 48n | BigInt(`0x${hex.slice(8, 12)}`) << 32n | BigInt(`0x${hex.slice(0, 8)}`)
          : BigInt(`0x${hex.slice(0, 12)}${hex.slice(13, 16)}`)
      const ms = Number(intervals / 10_000n) - GREGORIAN_OFFSET_MS
      out.Timestamp = new Date(ms).toISOString()
      out['Clock sequence'] = String(Number.parseInt(hex.slice(16, 20), 16) & 0x3fff)
      const node = hex.slice(20)
      // Bit 0 of the first node octet marks a random node ID rather than a real MAC.
      out.Node = `${node.match(/../g)!.join(':')}${Number.parseInt(node.slice(0, 2), 16) & 1 ? ' (random, not a MAC)' : ''}`
    } else if (version === 7) {
      out.Timestamp = new Date(Number.parseInt(hex.slice(0, 12), 16)).toISOString()
    } else if (version === 4) {
      out.Entropy = '122 random bits'
    }
    return out
  },
}

export const cryptoTools = [uuidTool, ulidTool, hashTool, hmacTool, totpHotpTool, tokenTool, passwordTool, passwordStrengthTool, jwtParser, jwtSigner, encryptionTool, rsaKeyPairTool, certParser, uuidInspector]
