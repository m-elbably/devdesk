import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

// --- Regex tester ---
const regexSchema = z.object({
  pattern: z.string(),
  flags: z.string().default('g'),
  text: z.string(),
})
export const regexTester: ToolPlugin = {
  metadata: metaFor('regex-tester'),
  schema: regexSchema,
  run: (input) => {
    const { pattern, flags, text } = regexSchema.parse(input)
    const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
    const matches = [...text.matchAll(re)].map((m) => ({
      match: m[0],
      index: m.index,
      groups: m.length > 1 ? m.slice(1) : undefined,
    }))
    return { count: matches.length, matches }
  },
}

// --- Cron generator ---
const cronSchema = z.object({
  minute: z.string().default('*'),
  hour: z.string().default('*'),
  dayOfMonth: z.string().default('*'),
  month: z.string().default('*'),
  dayOfWeek: z.string().default('*'),
})

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Field order of a standard 5-field expression, with each field's legal range. */
export const CRON_FIELDS = [
  { key: 'minute', label: 'Minute', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', min: 0, max: 23 },
  { key: 'dayOfMonth', label: 'Day of month', min: 1, max: 31 },
  { key: 'month', label: 'Month', min: 1, max: 12 },
  { key: 'dayOfWeek', label: 'Day of week', min: 0, max: 6 },
] as const

// Names accepted in the month and day-of-week fields, as most cron daemons do.
const CRON_NAMES: Record<string, number> = {
  ...Object.fromEntries(MONTH_NAMES.map((m, i) => [m.slice(0, 3).toLowerCase(), i + 1])),
  ...Object.fromEntries(DAY_NAMES.map((d, i) => [d.slice(0, 3).toLowerCase(), i])),
}

// Expand one cron field into the concrete values it matches. Handles wildcards,
// single values, lists (`1,15`), ranges (`1-5`), steps (`*/15`, `1-20/5`) and
// JAN/SUN style names. Throws on anything else, so the UI can point at the
// offending field rather than reject the whole expression.
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  const value = (raw: string): number => {
    const n = CRON_NAMES[raw.toLowerCase()] ?? Number(raw)
    if (!Number.isInteger(n)) throw new Error(`"${raw}" is not a valid value`)
    // Both 0 and 7 mean Sunday; normalise so day-of-week comparisons work.
    if (max === 6 && n === 7) return 0
    if (n < min || n > max) throw new Error(`"${raw}" is outside ${min}–${max}`)
    return n
  }
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${part}" has an invalid step`)
    let from: number, to: number
    if (range === '*') {
      ;[from, to] = [min, max]
    } else if (range!.includes('-')) {
      const [a, b] = range!.split('-')
      ;[from, to] = [value(a!), value(b!)]
      if (from > to) throw new Error(`"${range}" is a backwards range`)
    } else {
      // A bare value with a step (`5/10`) means "from 5 onwards", as cron does.
      from = value(range!)
      to = stepRaw === undefined ? from : max
    }
    for (let v = from; v <= to; v += step) out.add(v)
  }
  if (!out.size) throw new Error('matches nothing')
  return out
}

function parseExpression(expression: string) {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expected 5 fields, got ${parts.length}`)
  return CRON_FIELDS.map((f, i) => ({
    ...f,
    raw: parts[i]!,
    values: parseCronField(parts[i]!, f.min, f.max),
  }))
}

/**
 * The next `count` times the expression fires, in local time.
 *
 * ponytail: brute-force minute scan, skipping to the next midnight whenever the
 * date part can't match. Worst case (a date that never occurs, e.g. Feb 30) is
 * ~366 day-checks before giving up — cheap enough to run on every keystroke.
 */
export function nextCronRuns(expression: string, count = 5, from: Date = new Date()): Date[] {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parseExpression(expression)
  // Day-of-month and day-of-week are OR'd when both are restricted, AND'd otherwise.
  const bothDays = dayOfMonth!.raw !== '*' && dayOfWeek!.raw !== '*'
  const dateMatches = (d: Date) => {
    if (!month!.values.has(d.getMonth() + 1)) return false
    const dom = dayOfMonth!.values.has(d.getDate())
    const dow = dayOfWeek!.values.has(d.getDay())
    return bothDays ? dom || dow : dom && dow
  }

  const runs: Date[] = []
  const cursor = new Date(from)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = new Date(from).setFullYear(from.getFullYear() + 5)

  while (runs.length < count && cursor.getTime() < limit) {
    if (!dateMatches(cursor)) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!hour!.values.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (minute!.values.has(cursor.getMinutes())) runs.push(new Date(cursor))
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return runs
}

const list = (values: number[], format: (n: number) => string): string => {
  const parts = values.map(format)
  if (parts.length <= 1) return parts[0] ?? ''
  // A contiguous run reads far better as a range than as a comma soup, and it
  // keeps the common cases (Mon–Fri, 09:00–17:00) short.
  if (values.length > 2 && values.every((v, i) => i === 0 || v === values[i - 1]! + 1)) {
    return `${parts[0]} to ${parts.at(-1)}`
  }
  if (parts.length > 6) return `${parts.length} values (${parts[0]} to ${parts.at(-1)})`
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
const pad = (n: number) => String(n).padStart(2, '0')

/** Plain-English summary of a full expression. Throws if it doesn't parse. */
export function describeCron(expression: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parseExpression(expression)
  const minutes = [...minute!.values].sort((a, b) => a - b)
  const hours = [...hour!.values].sort((a, b) => a - b)
  const everyMinute = minute!.raw === '*'
  const everyHour = hour!.raw === '*'

  let time: string
  const minuteStep = /^\*\/(\d+)$/.exec(minute!.raw)
  if (everyMinute && everyHour) time = 'Every minute'
  else if (minuteStep && everyHour) time = `Every ${minuteStep[1]} minutes`
  else if (everyMinute) time = `Every minute past hour ${list(hours, String)}`
  else if (everyHour) time = `Every hour at minute ${list(minutes, String)}`
  else if (minutes.length === 1) time = `At ${list(hours, (h) => `${pad(h)}:${pad(minutes[0]!)}`)}`
  else time = `At minute ${list(minutes, String)} past hour ${list(hours, String)}`

  const sorted = (f: typeof minute) => [...f!.values].sort((a, b) => a - b)
  const days: string[] = []
  if (dayOfMonth!.raw !== '*') days.push(`on day ${list(sorted(dayOfMonth), String)} of the month`)
  if (dayOfWeek!.raw !== '*') days.push(`on ${list(sorted(dayOfWeek), (d) => DAY_NAMES[d]!)}`)

  // Both day fields restricted = OR, which is surprising enough to spell out.
  const when = [days.join(' or ') || 'every day']
  if (month!.raw !== '*') when.push(`in ${list(sorted(month), (m) => MONTH_NAMES[m - 1]!)}`)
  return `${time}, ${when.join(', ')}`
}

export const cronGenerator: ToolPlugin = {
  metadata: metaFor('cron-generator'),
  schema: cronSchema,
  run: (input) => {
    const c = cronSchema.parse(input)
    const expression = [c.minute, c.hour, c.dayOfMonth, c.month, c.dayOfWeek].join(' ')
    return { expression, description: describeCron(expression) }
  },
}

// --- Random port ---
const portSchema = z.object({ min: z.number().int().default(1024), max: z.number().int().default(65535) })
export const randomPort: ToolPlugin = {
  metadata: metaFor('random-port'),
  schema: portSchema,
  run: (input) => {
    const { min, max } = portSchema.parse(input)
    if (min > max) throw new Error('min must be ≤ max')
    return String(min + Math.floor(Math.random() * (max - min + 1)))
  },
}

// --- Git cheatsheet (reference) ---
export const GIT_COMMANDS: [string, string][] = [
  ['git status', 'Show working tree status'],
  ['git switch -c <branch>', 'Create and switch to a new branch'],
  ['git commit --amend', 'Edit the last commit'],
  ['git restore --staged <file>', 'Unstage a file'],
  ['git reset --hard <ref>', 'Discard changes and match a ref'],
  ['git rebase -i <ref>', 'Interactively rewrite history'],
  ['git cherry-pick <sha>', 'Apply a commit onto the current branch'],
  ['git stash', 'Stash uncommitted changes'],
  ['git log --oneline --graph', 'Compact commit graph'],
  ['git remote -v', 'List remotes'],
  ['git fetch --prune', 'Fetch and remove stale remote branches'],
  ['git reflog', 'Show reference history to recover commits'],
]
export const gitCheatsheet: ToolPlugin = {
  metadata: metaFor('git-cheatsheet'),
  schema: z.object({ query: z.string().default('') }),
  run: (input) => {
    const { query } = z.object({ query: z.string().default('') }).parse(input)
    const q = query.trim().toLowerCase()
    return GIT_COMMANDS.filter(([cmd, desc]) => !q || cmd.includes(q) || desc.toLowerCase().includes(q)).map(
      ([cmd, desc]) => `${cmd} — ${desc}`,
    )
  },
}

// --- Email normalizer ---
export const emailNormalizer: ToolPlugin = {
  metadata: metaFor('email-normalizer'),
  schema: z.object({ email: z.string() }),
  run: (input) => {
    const { email } = z.object({ email: z.string() }).parse(input)
    const trimmed = email.trim().toLowerCase()
    const at = trimmed.lastIndexOf('@')
    if (at === -1) throw new Error('Not an email address')
    let local = trimmed.slice(0, at)
    const domain = trimmed.slice(at + 1)
    local = local.split('+')[0]! // drop plus-addressing
    if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '')
    return `${local}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`
  },
}

// --- Case converter ---
function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}
export const caseConverter: ToolPlugin = {
  metadata: metaFor('case-converter'),
  schema: z.object({ text: z.string() }),
  run: (input) => {
    const { text } = z.object({ text: z.string() }).parse(input)
    const w = words(text)
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    return {
      camelCase: w.map((x, i) => (i ? cap(x) : x)).join(''),
      PascalCase: w.map(cap).join(''),
      snake_case: w.join('_'),
      'kebab-case': w.join('-'),
      CONSTANT_CASE: w.join('_').toUpperCase(),
      'Title Case': w.map(cap).join(' '),
    }
  },
}

// --- Chmod calculator ---
// Accepts either direction: "755"/"0755" or "rwxr-xr-x" (with or without the
// leading file-type character `ls -l` prints, e.g. "-rwxr-xr-x").
const chmodSchema = z.object({ mode: z.string() })

const CLASSES = ['Owner', 'Group', 'Others'] as const
/** Special bits, and which triad's execute slot encodes them in symbolic form. */
const SPECIAL = [
  { bit: 0b100, name: 'setuid', set: 's', unset: 'S' },
  { bit: 0b010, name: 'setgid', set: 's', unset: 'S' },
  { bit: 0b001, name: 'sticky', set: 't', unset: 'T' },
] as const

export const chmodCalculator: ToolPlugin = {
  metadata: metaFor('chmod-calculator'),
  schema: chmodSchema,
  run: (input) => {
    const mode = chmodSchema.parse(input).mode.trim()
    let special = 0
    const triads: number[] = []

    if (/^[0-7]{3,4}$/.test(mode)) {
      const digits = mode.padStart(4, '0')
      special = Number(digits[0])
      for (const d of digits.slice(1)) triads.push(Number(d))
    } else if (/^[-dlbcpsD]?[rwxsStT-]{9}$/.test(mode)) {
      const bits = mode.length === 10 ? mode.slice(1) : mode
      for (let t = 0; t < 3; t++) {
        const [r, w, x] = [bits[t * 3]!, bits[t * 3 + 1]!, bits[t * 3 + 2]!]
        // The execute slot does double duty: s/t mean the special bit is set
        // *and* execute is on; S/T mean the special bit is set and execute is off.
        const spec = SPECIAL[t]!
        if (x === spec.set || x === spec.unset) special |= spec.bit
        triads.push((r === 'r' ? 4 : 0) | (w === 'w' ? 2 : 0) | (x === 'x' || x === spec.set ? 1 : 0))
      }
    } else {
      throw new Error('Enter an octal mode (755 or 0755) or a symbolic one (rwxr-xr-x)')
    }

    const symbolic = triads
      .map((value, t) => {
        const spec = SPECIAL[t]!
        const exec = value & 1
        const x = special & spec.bit ? (exec ? spec.set : spec.unset) : exec ? 'x' : '-'
        return `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${x}`
      })
      .join('')
    const octal = `${special}${triads.join('')}`

    const describe = (value: number) =>
      [value & 4 && 'read', value & 2 && 'write', value & 1 && 'execute'].filter(Boolean).join(', ') || 'none'

    return {
      Octal: octal,
      'Octal (short)': octal.slice(1),
      Symbolic: symbolic,
      'ls -l': `-${symbolic}`,
      ...Object.fromEntries(CLASSES.map((name, t) => [name, describe(triads[t]!)])),
      Special: SPECIAL.filter((s) => special & s.bit).map((s) => s.name).join(', ') || 'none',
      Command: `chmod ${octal.startsWith('0') ? octal.slice(1) : octal} <file>`,
    }
  },
}

export const developmentTools = [
  regexTester,
  cronGenerator,
  randomPort,
  gitCheatsheet,
  emailNormalizer,
  caseConverter,
  chmodCalculator,
]
