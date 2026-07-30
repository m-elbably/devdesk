import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

const MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const

// "+90m", "-2d" — an offset from the current instant.
const OFFSET = /^([+-]\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i

// Midnight local time, N days from today. Uses setDate rather than adding
// 86_400_000ms so a DST boundary in between still lands on midnight.
function dayStart(offsetDays: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

/**
 * Accepts `now`, `today`/`tomorrow`/`yesterday`, a signed offset (`+2d`, `-90m`),
 * a Unix timestamp in seconds or milliseconds, or anything Date.parse handles.
 */
function parseDate(value: string): Date {
  const text = value.trim()
  const key = text.toLowerCase()
  const offset = OFFSET.exec(key)
  const milliseconds =
    key === 'now' ? Date.now()
    : key === 'today' ? dayStart(0).getTime()
    : key === 'tomorrow' ? dayStart(1).getTime()
    : key === 'yesterday' ? dayStart(-1).getTime()
    : offset ? Date.now() + Number(offset[1]) * MS[offset[2]!.toLowerCase() as keyof typeof MS]
    : /^-?\d+$/.test(text) ? Number(text) * (Math.abs(Number(text)) < 1e12 ? 1000 : 1)
    : Date.parse(text)
  const date = new Date(milliseconds)
  if (!text || Number.isNaN(date.getTime())) {
    throw new Error('Enter a date, Unix timestamp, “now”, “today”, or an offset like “+2d”')
  }
  return date
}

// Largest unit that fits, so a three-hour gap reads "3 hours ago" and not
// "10800 seconds ago". Intl does the pluralisation and localisation.
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', MS.w],
  ['day', MS.d],
  ['hour', MS.h],
  ['minute', MS.m],
  ['second', MS.s],
]
function relativeToNow(date: Date): string {
  const delta = date.getTime() - Date.now()
  const [unit, size] = RELATIVE_UNITS.find(([, s]) => Math.abs(delta) >= s) ?? RELATIVE_UNITS.at(-1)!
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(delta / size), unit)
}

// ISO-8601 week: weeks start Monday, and week 1 is the one holding the first
// Thursday — so early January can belong to the previous year's week 52/53.
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / MS.d + 1) / 7) }
}

function offsetLabel(date: Date): string {
  const minutes = -date.getTimezoneOffset()
  const abs = Math.abs(minutes)
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** Local wall-clock ISO string keeping the offset, e.g. 2026-07-19T14:30:00+02:00. */
export function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offsetLabel(date)}`
  )
}

function dateSummary(date: Date): Record<string, string> {
  const { year, week } = isoWeek(date)
  // Round rather than floor: a DST change makes the span an hour short or long.
  const dayOfYear =
    Math.round(
      (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
        new Date(date.getFullYear(), 0, 1).getTime()) / MS.d,
    ) + 1
  const y = date.getFullYear()
  return {
    Relative: relativeToNow(date),
    'ISO 8601 (UTC)': date.toISOString(),
    'ISO 8601 (local)': localIso(date),
    Local: date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }),
    'UTC / HTTP date': date.toUTCString(),
    'Unix seconds': String(Math.floor(date.getTime() / 1000)),
    'Unix milliseconds': String(date.getTime()),
    'Day of week': date.toLocaleDateString(undefined, { weekday: 'long' }),
    'Day of year': `${dayOfYear} of ${(y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365}`,
    'ISO week': `${year}-W${String(week).padStart(2, '0')}`,
    Quarter: `Q${Math.floor(date.getMonth() / 3) + 1} ${y}`,
    'Local time zone': `${Intl.DateTimeFormat().resolvedOptions().timeZone} (UTC${offsetLabel(date)})`,
    'Leap year': (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 'Yes' : 'No',
  }
}

export const timestampConverter: ToolPlugin = {
  metadata: metaFor('timestamp'),
  schema: z.object({ value: z.string() }),
  run: (input) => dateSummary(parseDate(z.object({ value: z.string() }).parse(input).value)),
}

// "GMT+9" style label for a zone at a given instant — accounts for that zone's
// DST state, which a fixed offset table cannot.
function zoneOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

const timezoneSchema = z.object({ value: z.string(), zones: z.string() })
export const timezoneConverter: ToolPlugin = {
  metadata: metaFor('timezone-converter'),
  schema: timezoneSchema,
  run: (input) => {
    const { value, zones } = timezoneSchema.parse(input)
    const date = parseDate(value)
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    // Local first, then the requested zones — deduped so naming your own zone
    // doesn't produce two identical rows.
    const wanted = [local, ...zones.split(',').map((z) => z.trim()).filter(Boolean)]
    const out: Record<string, string> = {}
    for (const zone of [...new Set(wanted)]) {
      try {
        const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone: zone }).format(date)
        out[zone === local ? `${zone} (local)` : zone] = `${when} · ${zoneOffset(date, zone)}`
      } catch {
        throw new Error(`“${zone}” is not a valid IANA time zone — try Europe/London or America/New_York`)
      }
    }
    out['ISO 8601 (UTC)'] = date.toISOString()
    out['Unix seconds'] = String(Math.floor(date.getTime() / 1000))
    return out
  },
}

const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * Calendar-aware Y/M/D between two instants, the way a person counts ("2 months
 * and 3 days"), rather than dividing milliseconds by an average month.
 *
 * Counts whole months forward from `from` and measures the remainder in days,
 * rather than subtracting the two dates field by field. Field subtraction needs
 * a borrow when the day-of-month decreases, and a single borrow is not always
 * enough: Jan 31 → Mar 1 borrows February's 28 days against a 30-day shortfall
 * and lands on a negative remainder.
 */
function calendarBreakdown(from: Date, to: Date): { years: number; months: number; days: number } {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (months > 0 && addMonths(from, months) > to) months-- // overshot the target day-of-month
  const anchor = addMonths(from, months)
  // Round: a DST change makes the intervening span an hour short or long.
  const days = Math.max(0, Math.round((dateOnly(to) - dateOnly(anchor)) / MS.d))
  return { years: Math.floor(months / 12), months: months % 12, days }
}

// Whole Mon–Fri days in [from, to). Public holidays are not modelled — they're
// jurisdiction-specific and would need a calendar this tool doesn't ship.
function weekdaysBetween(from: Date, to: Date): number {
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  let count = 0
  while (cursor < end) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) count++
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

const durationSchema = z.object({ start: z.string(), end: z.string() })
export const durationCalculator: ToolPlugin = {
  metadata: metaFor('duration-calculator'),
  schema: durationSchema,
  run: (input) => {
    const { start, end } = durationSchema.parse(input)
    const a = parseDate(start)
    const b = parseDate(end)
    const milliseconds = b.getTime() - a.getTime()
    const backwards = milliseconds < 0
    const [from, to] = backwards ? [b, a] : [a, b]

    let remaining = Math.abs(milliseconds)
    const days = Math.floor(remaining / MS.d)
    remaining %= MS.d
    const hours = Math.floor(remaining / MS.h)
    remaining %= MS.h
    const minutes = Math.floor(remaining / MS.m)
    const seconds = Math.floor((remaining % MS.m) / 1000)

    const { years, months, days: calDays } = calendarBreakdown(from, to)
    const calendar = [
      years && `${years}y`,
      months && `${months}mo`,
      calDays && `${calDays}d`,
    ].filter(Boolean).join(' ') || '0d'

    const round = (n: number) => String(Math.round(n * 100) / 100)
    return {
      Direction: backwards ? 'End is before start' : 'Forward',
      // Echo the resolved endpoints: the inputs accept "now"/"+7d", so without
      // these the answer never says which instants it actually measured.
      From: localIso(from),
      To: localIso(to),
      Duration: `${days}d ${hours}h ${minutes}m ${seconds}s`,
      Calendar: calendar,
      Relative: relativeToNow(b),
      'Business days': String(weekdaysBetween(from, to)),
      'Total weeks': round(Math.abs(milliseconds) / MS.w),
      'Total days': round(Math.abs(milliseconds) / MS.d),
      'Total hours': round(Math.abs(milliseconds) / MS.h),
      'Total minutes': round(Math.abs(milliseconds) / MS.m),
      'Total seconds': round(Math.abs(milliseconds) / 1000),
      Milliseconds: String(Math.abs(milliseconds)),
    }
  },
}

// Month/year arithmetic clamps to the last valid day, so "1 month after Jan 31"
// is Feb 28 rather than JS's default overflow into Mar 3.
function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return d
}

function addBusinessDays(date: Date, amount: number): Date {
  const d = new Date(date)
  const step = amount < 0 ? -1 : 1
  for (let left = Math.abs(amount); left > 0; ) {
    d.setDate(d.getDate() + step)
    if (d.getDay() !== 0 && d.getDay() !== 6) left--
  }
  return d
}

const DATE_UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'business days'] as const
const dateCalcSchema = z.object({
  date: z.string(),
  amount: z.number(),
  unit: z.enum(DATE_UNITS),
  direction: z.enum(['add', 'subtract']),
})
export const dateCalculator: ToolPlugin = {
  metadata: metaFor('date-calculator'),
  schema: dateCalcSchema,
  run: (input) => {
    const { date, amount, unit, direction } = dateCalcSchema.parse(input)
    const from = parseDate(date)
    const signed = direction === 'subtract' ? -amount : amount
    const d = new Date(from)
    switch (unit) {
      case 'years': return withOrigin(from, signed, unit, addMonths(from, signed * 12))
      case 'months': return withOrigin(from, signed, unit, addMonths(from, signed))
      case 'business days': return withOrigin(from, signed, unit, addBusinessDays(from, signed))
      // setDate/setHours keep wall-clock intent across a DST change: "+1 day"
      // stays the same time of day even when that day is 23 or 25 hours long.
      case 'weeks': d.setDate(d.getDate() + signed * 7); break
      case 'days': d.setDate(d.getDate() + signed); break
      case 'hours': d.setHours(d.getHours() + signed); break
      case 'minutes': d.setMinutes(d.getMinutes() + signed); break
      case 'seconds': d.setSeconds(d.getSeconds() + signed); break
    }
    return withOrigin(from, signed, unit, d)
  },
}
function withOrigin(from: Date, signed: number, unit: string, result: Date): Record<string, string> {
  return {
    From: from.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    Shift: `${signed >= 0 ? '+' : '−'}${Math.abs(signed)} ${unit}`,
    ...dateSummary(result),
  }
}

// Sign is an ISO 8601-2 extension; plenty of systems emit "-PT30M" so accept it.
const ISO_DURATION =
  /^([+-])?P(?!$)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?!$)(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
// "1h 30m", "90s", "2 days" — the shorthand people actually type.
const HUMAN_PART = /(\d+(?:\.\d+)?)\s*(years?|y|months?|mo|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|secs?|s|ms)/gi
const HUMAN_UNITS: Record<string, number> = {
  y: 31_536_000, year: 31_536_000, years: 31_536_000,
  mo: 2_592_000, month: 2_592_000, months: 2_592_000,
  w: 604_800, week: 604_800, weeks: 604_800,
  d: 86_400, day: 86_400, days: 86_400,
  h: 3_600, hour: 3_600, hours: 3_600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  ms: 0.001,
}

/** Total seconds for a duration written in ISO 8601, shorthand, or bare seconds. */
function durationToSeconds(text: string): number {
  const iso = ISO_DURATION.exec(text)
  if (iso) {
    const [, sign, y, mo, w, d, h, mi, s] = iso
    const n = (v: string | undefined) => Number(v ?? 0)
    const total =
      n(y) * 31_536_000 + n(mo) * 2_592_000 + n(w) * 604_800 + n(d) * 86_400 +
      n(h) * 3_600 + n(mi) * 60 + n(s)
    return sign === '-' ? -total : total
  }
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text.trim())

  let total = 0
  let matched = false
  for (const [, value, unit] of text.matchAll(HUMAN_PART)) {
    const factor = HUMAN_UNITS[unit!.toLowerCase()]
    if (factor === undefined) continue
    total += Number(value) * factor
    matched = true
  }
  if (!matched) throw new Error('Enter an ISO 8601 duration (PT1H30M), a shorthand like “1h 30m”, or a number of seconds')
  return /^\s*-/.test(text) ? -total : total
}

/** Seconds back to ISO 8601. Days and below only — Y/M have no fixed length. */
function secondsToIso(seconds: number): string {
  const abs = Math.abs(seconds)
  const d = Math.floor(abs / 86_400)
  const h = Math.floor((abs % 86_400) / 3_600)
  const m = Math.floor((abs % 3_600) / 60)
  const s = Math.round(((abs % 60) + Number.EPSILON) * 1000) / 1000
  const time = [h && `${h}H`, m && `${m}M`, s && `${s}S`].filter(Boolean).join('')
  const body = `${d ? `${d}D` : ''}${time ? `T${time}` : ''}` || 'T0S'
  return `${seconds < 0 ? '-' : ''}P${body}`
}

function humanDuration(seconds: number): string {
  const abs = Math.abs(seconds)
  const parts = [
    [Math.floor(abs / 86_400), 'day'],
    [Math.floor((abs % 86_400) / 3_600), 'hour'],
    [Math.floor((abs % 3_600) / 60), 'minute'],
    [Math.round(abs % 60), 'second'],
  ] as const
  const words = parts.filter(([v]) => v > 0).map(([v, u]) => `${v} ${u}${v === 1 ? '' : 's'}`)
  return words.length ? words.join(', ') : '0 seconds'
}

const isoDurationSchema = z.object({ value: z.string() })
export const isoDuration: ToolPlugin = {
  metadata: metaFor('iso-duration'),
  schema: isoDurationSchema,
  run: (input) => {
    const { value } = isoDurationSchema.parse(input)
    const seconds = durationToSeconds(value)
    const ends = new Date(Date.now() + seconds * 1000)
    return {
      'ISO 8601': secondsToIso(seconds),
      Human: humanDuration(seconds),
      'Total seconds': String(Math.round(seconds * 1000) / 1000),
      'Total minutes': String(Math.round((seconds / 60) * 1000) / 1000),
      'Total hours': String(Math.round((seconds / 3_600) * 1000) / 1000),
      'Total days': String(Math.round((seconds / 86_400) * 1000) / 1000),
      Milliseconds: String(Math.round(seconds * 1000)),
      'From now': `${ends.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${relativeToNow(ends)})`,
    }
  },
}

export const dateTimeTools = [timestampConverter, timezoneConverter, durationCalculator, dateCalculator, isoDuration]
