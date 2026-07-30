// js-yaml ships no types. This reference is load-bearing for consumers that
// compile our sources directly (apps/desktop) — their tsconfig doesn't include
// packages/tools/src, so the ambient declaration only reaches them from here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../js-yaml.d.ts" />
import { z } from 'zod'
import { dump, load } from 'js-yaml'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

const yamlDirection = z.enum(['JSON → YAML', 'YAML → JSON'])
const csvDirection = z.enum(['JSON → CSV', 'CSV → JSON'])
const linesDirection = z.enum(['JSON → JSON Lines', 'JSON Lines → JSON'])

export const jsonYaml: ToolPlugin = {
  metadata: metaFor('json-yaml'),
  schema: z.object({ text: z.string(), direction: yamlDirection }),
  run: (input) => {
    const { text, direction } = z.object({ text: z.string(), direction: yamlDirection }).parse(input)
    try {
      if (direction === 'JSON → YAML') return dump(JSON.parse(text), { noRefs: true, lineWidth: -1 })
      const value = load(text)
      if (value === undefined) throw new Error('YAML input is empty')
      return JSON.stringify(value, null, 2)
    } catch (error) {
      throw new Error(`Invalid ${direction === 'JSON → YAML' ? 'JSON' : 'YAML'}: ${(error as Error).message}`)
    }
  },
}

function parseCsv(text: string): string[][] {
  if (!text.trim()) throw new Error('CSV input is empty')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const jsonCsv: ToolPlugin = {
  metadata: metaFor('json-csv'),
  schema: z.object({ text: z.string(), direction: csvDirection }),
  run: (input) => {
    const { text, direction } = z.object({ text: z.string(), direction: csvDirection }).parse(input)
    if (direction === 'JSON → CSV') {
      let values: unknown
      try { values = JSON.parse(text) } catch (error) { throw new Error(`Invalid JSON: ${(error as Error).message}`) }
      if (!Array.isArray(values) || values.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error('JSON must be an array of objects')
      }
      const records = values as Record<string, unknown>[]
      const headers = [...new Set(records.flatMap(Object.keys))]
      if (!headers.length) return ''
      return [headers, ...records.map((record) => headers.map((header) => record[header]))]
        .map((row) => row.map(csvCell).join(','))
        .join('\n')
    }

    const [headers, ...rows] = parseCsv(text)
    if (!headers?.length || headers.some((header) => !header)) throw new Error('CSV requires a non-empty header row')
    if (new Set(headers).size !== headers.length) throw new Error('CSV headers must be unique')
    return JSON.stringify(rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))), null, 2)
  },
}

export const jsonLines: ToolPlugin = {
  metadata: metaFor('json-lines'),
  schema: z.object({ text: z.string(), direction: linesDirection }),
  run: (input) => {
    const { text, direction } = z.object({ text: z.string(), direction: linesDirection }).parse(input)
    try {
      if (direction === 'JSON → JSON Lines') {
        const values = JSON.parse(text)
        if (!Array.isArray(values)) throw new Error('JSON must be an array')
        return values.map((value) => JSON.stringify(value)).join('\n')
      }
      const lines = text.split(/\r?\n/).filter((line) => line.trim())
      if (!lines.length) throw new Error('JSON Lines input is empty')
      return JSON.stringify(lines.map((line) => JSON.parse(line)), null, 2)
    } catch (error) {
      throw new Error(`Invalid input: ${(error as Error).message}`)
    }
  },
}

// --- XML ↔ JSON ---
// ponytail: hand-rolled parser. This package is `environment: 'node'` and DOM-free
// by contract, so DOMParser is off the table, and a dependency for one tool isn't
// worth the bundle. Handles elements, attributes, text, CDATA, comments, PIs and
// the predefined + numeric entities.
// Ceiling: no DTD/internal-entity declarations, and namespace prefixes are kept as
// literal name parts rather than resolved. Swap in fast-xml-parser if either lands.

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity[0] !== '#') return XML_ENTITIES[entity] ?? whole
    const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[c]!};`)

/**
 * An element collapses to its trimmed text when it has no attributes and no
 * children — the shape people expect from `<name>Ada</name>`. Otherwise it
 * becomes an object: attributes prefixed `@`, mixed-in text under `#text`, and
 * repeated child names gathered into an array.
 */
function xmlValue(attrs: Record<string, string>, children: { name: string; value: unknown }[], text: string): unknown {
  const trimmed = text.trim()
  if (!children.length && !Object.keys(attrs).length) return trimmed
  const out: Record<string, unknown> = { ...attrs }
  for (const child of children) {
    const existing = out[child.name]
    if (existing === undefined) out[child.name] = child.value
    else if (Array.isArray(existing)) (existing as unknown[]).push(child.value)
    else out[child.name] = [existing, child.value]
  }
  if (trimmed) out['#text'] = trimmed
  return out
}

function parseXml(source: string): { name: string; value: unknown } {
  let i = 0
  // Annotated on the variable, not just the arrow: that is what lets TS treat a
  // fail() call as unreachable and narrow the code after it.
  const fail: (message: string) => never = (message) => {
    throw new Error(`${message} (at position ${i})`)
  }
  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++
  }
  // Consume a delimited run (comment, PI, CDATA); returns its inner text.
  const consume = (open: string, close: string, label: string): string => {
    const end = source.indexOf(close, i + open.length)
    if (end < 0) fail(`Unterminated ${label}`)
    const inner = source.slice(i + open.length, end)
    i = end + close.length
    return inner
  }
  const skipMisc = () => {
    for (;;) {
      skipSpace()
      if (source.startsWith('<!--', i)) consume('<!--', '-->', 'comment')
      else if (source.startsWith('<?', i)) consume('<?', '?>', 'processing instruction')
      else if (source.startsWith('<!', i)) {
        // DOCTYPE, possibly with an internal subset — scan to the balanced '>'.
        let depth = 0
        while (i < source.length) {
          const c = source[i++]!
          if (c === '[') depth++
          else if (c === ']') depth--
          else if (c === '>' && depth <= 0) break
        }
      } else return
    }
  }
  const parseName = (): string => {
    const start = i
    while (i < source.length && !/[\s/>=]/.test(source[i]!)) i++
    if (i === start) fail('Expected an element or attribute name')
    return source.slice(start, i)
  }

  function parseElement(): { name: string; value: unknown } {
    i++ // consume '<'
    const name = parseName()
    const attrs: Record<string, string> = {}
    for (;;) {
      skipSpace()
      if (source.startsWith('/>', i)) {
        i += 2
        return { name, value: xmlValue(attrs, [], '') }
      }
      if (source[i] === '>') {
        i++
        break
      }
      if (i >= source.length) fail(`Unclosed start tag <${name}>`)
      const attr = parseName()
      skipSpace()
      if (source[i] !== '=') fail(`Attribute "${attr}" has no value`)
      i++
      skipSpace()
      const quote = source[i]
      if (quote !== '"' && quote !== "'") fail(`Value of attribute "${attr}" must be quoted`)
      const end = source.indexOf(quote, i + 1)
      if (end < 0) fail(`Unterminated value for attribute "${attr}"`)
      attrs[`@${attr}`] = decodeXmlText(source.slice(i + 1, end))
      i = end + 1
    }

    const children: { name: string; value: unknown }[] = []
    let text = ''
    for (;;) {
      if (i >= source.length) fail(`Unclosed element <${name}>`)
      if (source.startsWith('</', i)) {
        i += 2
        const closing = parseName()
        if (closing !== name) fail(`Closing tag </${closing}> does not match <${name}>`)
        skipSpace()
        if (source[i] !== '>') fail(`Expected ">" to close </${closing}>`)
        i++
        return { name, value: xmlValue(attrs, children, text) }
      }
      if (source.startsWith('<!--', i)) consume('<!--', '-->', 'comment')
      else if (source.startsWith('<![CDATA[', i)) text += consume('<![CDATA[', ']]>', 'CDATA section')
      else if (source.startsWith('<?', i)) consume('<?', '?>', 'processing instruction')
      else if (source[i] === '<') children.push(parseElement())
      else {
        const next = source.indexOf('<', i)
        text += decodeXmlText(source.slice(i, next < 0 ? source.length : next))
        i = next < 0 ? source.length : next
      }
    }
  }

  skipMisc()
  if (source[i] !== '<') fail('XML must start with a root element')
  const root = parseElement()
  skipMisc()
  if (i < source.length) fail('XML has content after the root element')
  return root
}

function buildXml(name: string, value: unknown, indent: string): string {
  if (Array.isArray(value)) return value.map((item) => buildXml(name, item, indent)).join('\n')
  if (value === null || value === undefined) return `${indent}<${name}/>`
  if (typeof value !== 'object') return `${indent}<${name}>${escapeXml(String(value))}</${name}>`

  const entries = Object.entries(value as Record<string, unknown>)
  const attrs = entries
    .filter(([key]) => key.startsWith('@'))
    .map(([key, v]) => ` ${key.slice(1)}="${escapeXml(String(v))}"`)
    .join('')
  const children = entries.filter(([key]) => !key.startsWith('@') && key !== '#text')
  const text = (value as Record<string, unknown>)['#text']

  if (!children.length) {
    const inner = text === undefined ? '' : escapeXml(String(text))
    return inner ? `${indent}<${name}${attrs}>${inner}</${name}>` : `${indent}<${name}${attrs}/>`
  }
  const body = [
    ...(text === undefined ? [] : [`${indent}  ${escapeXml(String(text))}`]),
    ...children.map(([key, v]) => buildXml(key, v, `${indent}  `)),
  ].join('\n')
  return `${indent}<${name}${attrs}>\n${body}\n${indent}</${name}>`
}

const xmlDirection = z.enum(['XML → JSON', 'JSON → XML'])
const xmlSchema = z.object({ text: z.string(), direction: xmlDirection })

export const xmlJson: ToolPlugin = {
  metadata: metaFor('xml-json'),
  schema: xmlSchema,
  run: (input) => {
    const { text, direction } = xmlSchema.parse(input)
    if (direction === 'XML → JSON') {
      if (!text.trim()) throw new Error('XML input is empty')
      const { name, value } = parseXml(text)
      return JSON.stringify({ [name]: value }, null, 2)
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`Invalid JSON: ${(error as Error).message}`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON must be an object with a single root key')
    }
    const roots = Object.keys(value as Record<string, unknown>)
    if (roots.length !== 1) throw new Error(`XML needs exactly one root element, but the JSON has ${roots.length} top-level keys`)
    return `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml(roots[0]!, (value as Record<string, unknown>)[roots[0]!], '')}`
  },
}

// --- .env ↔ JSON ---
const envDirection = z.enum(['.env → JSON', 'JSON → .env'])
const envSchema = z.object({ text: z.string(), direction: envDirection })

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // `export FOO=bar` is valid in a sourced .env; the prefix is not part of the key.
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq < 1) throw new Error(`Line ${index + 1} is not KEY=VALUE: ${line}`)
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) throw new Error(`Line ${index + 1} has an invalid key: ${key}`)
    const raw = body.slice(eq + 1).trim()
    const quote = raw[0]
    if ((quote === '"' || quote === "'") && raw.length > 1 && raw.at(-1) === quote) {
      const inner = raw.slice(1, -1)
      // Only double quotes interpret escapes — same rule as a POSIX shell.
      out[key] = quote === '"' ? inner.replace(/\\([nrt\\"])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c) : inner
    } else {
      // Unquoted values end at an inline comment.
      out[key] = raw.replace(/\s+#.*$/, '').trim()
    }
  }
  return out
}

export const envJson: ToolPlugin = {
  metadata: metaFor('env-json'),
  schema: envSchema,
  run: (input) => {
    const { text, direction } = envSchema.parse(input)
    if (!text.trim()) throw new Error('Input is empty')
    if (direction === '.env → JSON') return JSON.stringify(parseEnv(text), null, 2)

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`Invalid JSON: ${(error as Error).message}`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON must be an object')
    return Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => {
        // Objects/arrays have no dotenv representation, so they go in as JSON text.
        const text = raw == null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
        const needsQuotes = text === '' || /[\s#"'\\]/.test(text)
        return `${key}=${needsQuotes ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : text}`
      })
      .join('\n')
  },
}

export const dataFormatTools = [jsonYaml, jsonCsv, jsonLines, xmlJson, envJson]
