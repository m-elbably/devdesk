import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

// --- shared helpers ---
/** Parse JSON, throwing a consistent, readable error on malformed input. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Invalid JSON: ${msg}`)
  }
}

// --- Editor (first JSON tool: a full vanilla-jsoneditor-backed editor) ---
const editorSchema = z.object({ text: z.string().default('') })
export const jsonEditor: ToolPlugin = {
  metadata: metaFor('json-editor'),
  schema: editorSchema,
  run: (input) => {
    const { text } = editorSchema.parse(input)
    if (!text.trim()) return ''
    return JSON.stringify(parseJson(text), null, 2)
  },
}

// --- Diff ---
/** One structural difference between two JSON docs, for colored rendering. */
export type JsonChange = {
  path: string
  kind: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}

function typeOf(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
}

function diffJson(a: unknown, b: unknown, path = '$'): JsonChange[] {
  if (a === b) return []
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (ta !== tb) return [{ path, kind: 'changed', before: a, after: b }]
  if (ta === 'object') {
    const objA = a as Record<string, unknown>
    const objB = b as Record<string, unknown>
    const keys = new Set([...Object.keys(objA), ...Object.keys(objB)])
    const out: JsonChange[] = []
    for (const k of keys) {
      if (!(k in objA)) out.push({ path: `${path}.${k}`, kind: 'added', after: objB[k] })
      else if (!(k in objB)) out.push({ path: `${path}.${k}`, kind: 'removed', before: objA[k] })
      else out.push(...diffJson(objA[k], objB[k], `${path}.${k}`))
    }
    return out
  }
  if (ta === 'array') {
    const arrA = a as unknown[]
    const arrB = b as unknown[]
    const out: JsonChange[] = []
    for (let i = 0; i < Math.max(arrA.length, arrB.length); i++) {
      if (i >= arrA.length) out.push({ path: `${path}[${i}]`, kind: 'added', after: arrB[i] })
      else if (i >= arrB.length) out.push({ path: `${path}[${i}]`, kind: 'removed', before: arrA[i] })
      else out.push(...diffJson(arrA[i], arrB[i], `${path}[${i}]`))
    }
    return out
  }
  return [{ path, kind: 'changed', before: a, after: b }]
}

const diffSchema = z.object({ left: z.string(), right: z.string() })
export const jsonDiff: ToolPlugin = {
  metadata: metaFor('json-diff'),
  schema: diffSchema,
  run: (input) => {
    const { left, right } = diffSchema.parse(input)
    return diffJson(parseJson(left), parseJson(right))
  },
}

// --- JSON → TypeScript ---
const TS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'type', 'typeof', 'var', 'void', 'while', 'with', 'as',
  'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield', 'any',
  'unknown', 'never', 'string', 'number', 'boolean', 'object', 'symbol', 'undefined',
])

/** Make a valid TypeScript identifier, prefixing/escaping reserved or illegal names. */
function toIdentifier(name: string, fallback = 'Root'): string {
  let id = name.replace(/[^a-zA-Z0-9_$]/g, '_')
  if (id === '') id = fallback
  if (/^[0-9]/.test(id)) id = `_${id}`
  if (TS_RESERVED.has(id)) id = `${id}_`
  return id
}

/** Convert an arbitrary key into a PascalCase type name. */
function pascal(name: string): string {
  const base = toIdentifier(name, 'Root')
  const out = base
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/(?:^|\s)([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/\s+/g, '')
  return /^[a-zA-Z]/.test(out) ? out : `T${out}`
}

function singular(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y')
  if (/s$/i.test(name) && name.length > 1) return name.slice(0, -1)
  return name
}

type TsCtx = {
  interfaces: Map<string, string>
  /** Interface body → name, so identically-shaped objects share one interface. */
  seen: Map<string, string>
  counts: Map<string, number>
}

const isIdent = (k: string): boolean => /^[a-zA-Z_$][\w$]*$/.test(k)
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Merge every object observed at one position into a single interface: a key
 * missing from some samples becomes optional, and its type unions across the
 * samples that do have it. Without this, `[{a:1}, {a:1, b:2}]` produced two
 * near-identical interfaces instead of one with `b?: number`.
 */
function objectType(samples: Record<string, unknown>[], name: string, ctx: TsCtx): string {
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s)))]
  const props = keys.map((k) => {
    const present = samples.filter((s) => k in s)
    const key = isIdent(k) && !TS_RESERVED.has(k) ? k : JSON.stringify(k)
    const optional = present.length < samples.length ? '?' : ''
    return `  ${key}${optional}: ${inferType(present.map((s) => s[k]), k, ctx)}`
  })
  // Dedupe on the finished body rather than a separate signature: children are
  // generated (and deduped) first, so identical shapes produce identical text.
  const body = `{\n${props.join('\n')}\n}`
  const existing = ctx.seen.get(body)
  if (existing) return existing
  const base = pascal(name)
  const n = (ctx.counts.get(base) ?? 0) + 1
  ctx.counts.set(base, n)
  const iName = n > 1 ? `${base}${n}` : base
  ctx.seen.set(body, iName)
  ctx.interfaces.set(iName, `interface ${iName} ${body}`)
  return iName
}

/** Type covering every value observed at one position (all array elements, all samples of a key). */
function inferType(values: unknown[], name: string, ctx: TsCtx): string {
  const nonNull = values.filter((v) => v !== null)
  if (!nonNull.length) return values.length ? 'null' : 'unknown'

  const parts = new Set<string>()
  for (const v of nonNull) if (!isPlainObject(v) && !Array.isArray(v)) parts.add(typeof v)

  const arrays = nonNull.filter(Array.isArray)
  if (arrays.length) {
    const items = arrays.flat()
    const item = items.length ? inferType(items, singular(name), ctx) : 'unknown'
    parts.add(item.includes('|') ? `(${item})[]` : `${item}[]`)
  }

  const objects = nonNull.filter(isPlainObject)
  if (objects.length) parts.add(objectType(objects, name, ctx))

  // null last: `string | null` reads better than `null | string`.
  if (nonNull.length < values.length) parts.add('null')
  return [...parts].join(' | ')
}

const toTsSchema = z.object({ text: z.string(), rootName: z.string().default('Root') })
export const jsonToTs: ToolPlugin = {
  metadata: metaFor('json-to-ts'),
  schema: toTsSchema,
  run: (input) => {
    const { text, rootName } = toTsSchema.parse(input)
    const ctx: TsCtx = { interfaces: new Map(), seen: new Map(), counts: new Map() }
    const rootType = inferType([parseJson(text)], rootName, ctx)
    const rootName1 = pascal(rootName)
    const interfacesOut = [...ctx.interfaces.values()].reverse()
    // If the root itself became an interface, it's already in the list. Otherwise
    // expose the root as a type alias (primitive, array, or array of interfaces).
    if (ctx.interfaces.has(rootName1)) return interfacesOut.join('\n\n')
    return [`type ${rootName1} = ${rootType}`, ...interfacesOut].join('\n\n')
  },
}

export const jsonTools = [jsonEditor, jsonDiff, jsonToTs]
