import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

const mode = z.enum(['encode', 'decode'])

// Unicode-safe Base64 via TextEncoder + btoa/atob (present in browsers, Workers, Node 18+).
const b64Schema = z.object({
  text: z.string(),
  mode: mode.default('encode'),
  variant: z.enum(['standard', 'url-safe']).default('standard'),
  padding: z.boolean().default(true),
})

// Takes bytes, not a string: anything that already holds raw bytes must not be
// round-tripped through a latin1 string and back through TextEncoder, or every
// byte >= 0x80 silently becomes two UTF-8 bytes.
function bytesToB64(bytes: Uint8Array, variant = 'standard', padding = true): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  let out = btoa(bin)
  if (variant === 'url-safe') out = out.replace(/\+/g, '-').replace(/\//g, '_')
  return padding ? out : out.replace(/=+$/, '')
}

function b64encode(s: string, variant: string, padding: boolean): string {
  return bytesToB64(new TextEncoder().encode(s), variant, padding)
}

// Decoding is deliberately liberal about the variant: base64 and base64url differ
// only in two characters, and pasted values routinely carry MIME line breaks or
// have lost their padding. Normalising here beats making the user first work out
// which flavour they were handed.
function b64decode(s: string): string {
  const normalized = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(normalized)) {
    throw new Error('Not valid Base64 — expected only A-Z, a-z, 0-9, +, / (or -, _ for URL-safe).')
  }
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  let bin: string
  try {
    bin = atob(padded)
  } catch {
    throw new Error('Not valid Base64 — the input length is wrong, even after padding.')
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export const base64: ToolPlugin = {
  metadata: metaFor('base64'),
  schema: b64Schema,
  run: (input) => {
    const { text, mode, variant, padding } = b64Schema.parse(input)
    return mode === 'encode' ? b64encode(text, variant, padding) : b64decode(text)
  },
}

const urlSchema = z.object({
  text: z.string(),
  mode: mode.default('encode'),
  variant: z.enum(['component', 'full-uri', 'form']).default('component'),
})

export const urlEncoder: ToolPlugin = {
  metadata: metaFor('url-encoder'),
  schema: urlSchema,
  run: (input) => {
    const { text, mode, variant } = urlSchema.parse(input)
    if (mode === 'decode') {
      // A `+` only means "space" in form encoding; elsewhere it is a literal plus.
      const prepared = variant === 'form' ? text.replace(/\+/g, '%20') : text
      try {
        return decodeURIComponent(prepared)
      } catch {
        throw new Error('Malformed percent-encoding — a % must be followed by two hex digits.')
      }
    }
    if (variant === 'full-uri') return encodeURI(text)
    const encoded = encodeURIComponent(text)
    // application/x-www-form-urlencoded: spaces are `+`, and the characters
    // encodeURIComponent leaves alone but the form spec escapes.
    return variant === 'form'
      ? encoded.replace(/%20/g, '+').replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
      : encoded
  },
}

const htmlSchema = z.object({
  text: z.string(),
  mode: mode.default('encode'),
  variant: z.enum(['minimal', 'non-ascii']).default('minimal'),
})

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// Named entities we decode beyond the five we emit. The HTML Latin-1 block maps
// to code points 160-255 *in order*, so it's a word list plus its index rather
// than 96 hand-written pairs — which is also how it stays correct, since a typo
// in a hand-written table is invisible until someone pastes that one character.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
const NAMED: Record<string, string> = {
  ...Object.fromEntries(LATIN1.split(' ').map((name, i) => [name, String.fromCharCode(160 + i)])),
  // Outside Latin-1: the five we emit, plus the punctuation that turns up most
  // often in copy pasted out of a CMS or word processor.
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', dagger: '†', permil: '‰', trade: '™', euro: '€',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

export const htmlEscape: ToolPlugin = {
  metadata: metaFor('html-escape'),
  schema: htmlSchema,
  run: (input) => {
    const { text, mode, variant } = htmlSchema.parse(input)
    if (mode === 'encode') {
      const escaped = text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)
      // Legacy/ASCII-only transports (older email templates, some CMS fields) need
      // every non-ASCII character as a numeric reference too. Uses code points, so
      // astral characters like emoji survive as one reference instead of two halves.
      return variant === 'non-ascii'
        ? [...escaped].map((c) => (c.codePointAt(0)! > 127 ? `&#${c.codePointAt(0)};` : c)).join('')
        : escaped
    }
    // Decode any entity, not just the five we emit — pasted HTML is full of
    // &nbsp;, &#x27; and friends, and leaving those untouched looks like a no-op.
    return text.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
      }
      return NAMED[body] ?? match
    })
  },
}

// --- Hex / binary converter ---
// One input plus a "from" format, and every other representation comes back at
// once (like case-converter / ip-converter) — a from→to pair of selects would
// double the clicks to answer "what is this in the other three?".
const hexSchema = z.object({
  text: z.string(),
  from: z.enum(['text', 'hex', 'binary', 'decimal']).default('text'),
})

const toBytes: Record<string, (s: string) => Uint8Array> = {
  text: (s) => new TextEncoder().encode(s),
  // Accept the shapes people actually paste: "48 65", "48:65", "0x48,0x65", "4865".
  hex: (s) => {
    const clean = s.replace(/0[xX]/g, '').replace(/[\s,:;-]/g, '')
    if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Hex input may only contain 0-9 and a-f.')
    if (clean.length % 2) throw new Error('Hex input needs an even number of digits — one byte is two digits.')
    return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16))
  },
  binary: (s) => {
    const clean = s.replace(/[\s,:;-]/g, '')
    if (!/^[01]*$/.test(clean)) throw new Error('Binary input may only contain 0 and 1.')
    if (clean.length % 8) throw new Error('Binary input needs a multiple of 8 digits — one byte is eight bits.')
    return Uint8Array.from(clean.match(/.{8}/g) ?? [], (b) => parseInt(b, 2))
  },
  decimal: (s) => {
    const parts = s.split(/[\s,:;]+/).filter(Boolean)
    return Uint8Array.from(parts, (p) => {
      const n = Number(p)
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`"${p}" is not a byte value (0-255).`)
      return n
    })
  },
}

export const hexConverter: ToolPlugin = {
  metadata: metaFor('hex-converter'),
  schema: hexSchema,
  run: (input) => {
    const { text, from } = hexSchema.parse(input)
    const bytes = toBytes[from]!(text)
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'))
    return {
      // `fatal` so bytes that aren't valid UTF-8 say so instead of silently
      // becoming a row of U+FFFD replacement characters that looks like real output.
      Text: (() => {
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          return '(not valid UTF-8 text)'
        }
      })(),
      Hex: hex.join(''),
      'Hex (spaced)': hex.join(' '),
      Binary: [...bytes].map((b) => b.toString(2).padStart(8, '0')).join(' '),
      Decimal: [...bytes].join(' '),
      Base64: bytesToB64(bytes),
      Bytes: String(bytes.length),
    }
  },
}

// --- Unicode inspector ---
// No JS runtime exposes the Unicode *names* database, and shipping ~40k names to
// answer "what is this character" is not worth the bundle — the general category
// plus the encodings covers the question people actually arrive with (why does
// this string break my column / regex / byte limit).
const CATEGORIES: [string, RegExp][] = [
  ['Letter', /\p{L}/u],
  ['Mark', /\p{M}/u],
  ['Number', /\p{N}/u],
  ['Punctuation', /\p{P}/u],
  ['Symbol', /\p{S}/u],
  ['Separator', /\p{Z}/u],
  ['Control/Other', /\p{C}/u],
]

export const unicodeInspector: ToolPlugin = {
  metadata: metaFor('unicode-inspector'),
  schema: z.object({ text: z.string() }),
  run: (input) => {
    const { text } = z.object({ text: z.string() }).parse(input)
    // Iterating the string yields code points, not UTF-16 units, so an emoji is
    // one row rather than two meaningless surrogate halves.
    return [...text].map((ch) => {
      const cp = ch.codePointAt(0)!
      const u = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
      const utf8 = [...new TextEncoder().encode(ch)].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
      const category = CATEGORIES.find(([, re]) => re.test(ch))?.[0] ?? 'Unknown'
      // Control characters have no glyph; showing the raw character would render
      // as nothing at all, so name it instead of leaving the column blank.
      const glyph = /\p{C}/u.test(ch) ? '·' : ch
      return `${u}  ${glyph}  ${category}  UTF-8 ${utf8}  \\u{${cp.toString(16).toUpperCase()}}  &#${cp};`
    })
  },
}

// --- Escape for code contexts ---
// The five contexts where pasting a raw string is how injection bugs and broken
// builds happen. One input, every context at once — you rarely know up front
// which one you need, and comparing them is the point.
const CTRL: Record<string, string> = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v' }
const jsEscape = (s: string, quote: string) =>
  s.replace(/[\\\b\f\n\r\t\v'"`]/g, (c) => CTRL[c] ?? (c === '\\' || c === quote ? `\\${c}` : c))

export const codeEscape: ToolPlugin = {
  metadata: metaFor('code-escape'),
  schema: z.object({ text: z.string() }),
  run: (input) => {
    const { text } = z.object({ text: z.string() }).parse(input)
    return {
      'JavaScript (single)': `'${jsEscape(text, "'")}'`,
      'JavaScript (double)': `"${jsEscape(text, '"')}"`,
      JSON: JSON.stringify(text),
      // Doubling the quote is the one escape every SQL dialect agrees on;
      // backslash escapes are MySQL-specific and vary by mode.
      'SQL (single-quoted)': `'${text.replace(/'/g, "''")}'`,
      // Single quotes make a POSIX shell take everything literally, so the only
      // thing needing care is a literal single quote — hence the '"'"' dance.
      'Shell (POSIX)': `'${text.replace(/'/g, `'"'"'`)}'`,
      // Escapes every character with meaning in a regex, so the result matches
      // the input as a literal.
      'Regex literal': text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'),
    }
  },
}

export const encodingTools = [base64, urlEncoder, htmlEscape, hexConverter, unicodeInspector, codeEscape]
