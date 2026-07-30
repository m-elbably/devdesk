import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'
import { localIso } from './date-time'

const round = (n: number, dp = 2) => (Number.isFinite(n) ? Number(n.toFixed(dp)) : 0)
/** Display form: trims trailing zeros and keeps big numbers readable. */
const num = (n: number, dp = 4): string =>
  Number.isFinite(n) ? Number(n.toFixed(dp)).toLocaleString('en-US', { maximumFractionDigits: dp }) : '—'
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

const pctSchema = z.object({ x: z.number(), y: z.number() })
export const percentage: ToolPlugin = {
  metadata: metaFor('percentage'),
  schema: pctSchema,
  run: (input) => {
    const { x, y } = pctSchema.parse(input)
    // Integer ratio only — 2.5 : 5 has no meaningful gcd, so it rounds first.
    const divisor = gcd(Math.abs(Math.round(x)), Math.abs(Math.round(y))) || 1
    return {
      'X is what % of Y': `${round(y === 0 ? 0 : (x / y) * 100)}%`,
      'Y is what % of X': `${round(x === 0 ? 0 : (y / x) * 100)}%`,
      'X% of Y': String(round((x / 100) * y)),
      '% change X → Y': `${round(x === 0 ? 0 : ((y - x) / Math.abs(x)) * 100)}%`,
      'Difference (Y − X)': String(round(y - x)),
      'X increased by Y%': String(round(x * (1 + y / 100))),
      'X decreased by Y%': String(round(x * (1 - y / 100))),
      'Ratio X : Y': `${round(x / divisor)} : ${round(y / divisor)}`,
    }
  },
}

function humanDuration(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return '—'
  const units: [string, number][] = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]
  const parts: string[] = []
  let rem = Math.round(seconds)
  for (const [label, size] of units) {
    if (rem >= size) {
      parts.push(`${Math.floor(rem / size)}${label}`)
      rem %= size
    }
  }
  return parts.slice(0, 2).join(' ') || '0s'
}

const ELAPSED_UNITS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const
const etaSchema = z.object({
  total: z.number().positive(),
  done: z.number().min(0),
  elapsed: z.number().positive(),
  elapsedUnit: z.enum(['seconds', 'minutes', 'hours', 'days']).default('seconds'),
})
export const eta: ToolPlugin = {
  metadata: metaFor('eta'),
  schema: etaSchema,
  run: (input) => {
    const { total, done, elapsed, elapsedUnit } = etaSchema.parse(input)
    const elapsedSeconds = elapsed * ELAPSED_UNITS[elapsedUnit]
    const rate = done / elapsedSeconds // units per second
    const remaining = rate > 0 ? (total - done) / rate : Infinity
    const finishes = Number.isFinite(remaining) ? new Date(Date.now() + remaining * 1000) : null
    return {
      'Percent complete': `${round((done / total) * 100)}%`,
      Remaining: humanDuration(remaining),
      // Started/Finishes bound the progress bar drawn above the table.
      Started: localIso(new Date(Date.now() - elapsedSeconds * 1000)),
      'Finishes at': finishes ? localIso(finishes) : '—',
      'Work left': num(Math.max(0, total - done)),
      Rate: `${num(rate)} / s`,
      'Rate (per minute)': num(rate * 60),
      'Rate (per hour)': num(rate * 3600),
      'Total time': humanDuration(rate > 0 ? total / rate : Infinity),
    }
  },
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const
const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
/** Largest unit that keeps the number above 1 — how a file manager prints a size. */
function human(bytes: number, base: number, units: readonly string[]): string {
  const i = bytes <= 0 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)))
  return `${num(bytes / base ** i, 2)} ${units[i]}`
}

const byteSchema = z.object({
  value: z.number().min(0),
  unit: z.enum(BYTE_UNITS).default('MB'),
  base: z.enum(['SI (1000)', 'IEC (1024)']).default('SI (1000)'),
})
export const byteConverter: ToolPlugin = {
  metadata: metaFor('byte-converter'),
  schema: byteSchema,
  run: (input) => {
    const { value, unit, base } = byteSchema.parse(input)
    const iec = base === 'IEC (1024)'
    const factor = iec ? 1024 : 1000
    const units = iec ? IEC_UNITS : BYTE_UNITS
    const bytes = value * factor ** BYTE_UNITS.indexOf(unit)
    const out: Record<string, string | number> = {}
    units.forEach((u, i) => (out[u] = round(bytes / factor ** i, 4)))
    // Both human forms always: the gap between them is the "why is my 500 GB
    // drive 465 GB" question, and showing both answers it without a lookup.
    out['Human (SI)'] = human(bytes, 1000, BYTE_UNITS)
    out['Human (IEC)'] = human(bytes, 1024, IEC_UNITS)
    out['Bytes (exact)'] = num(bytes, 0)
    out['Bits'] = num(bytes * 8, 0)
    return out
  },
}

// --- Number statistics -------------------------------------------------------

/** Pull every number out of free-form text — commas, spaces, newlines, log lines. */
export function parseNumbers(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number).filter(Number.isFinite)
}

/** Linear-interpolated percentile (the R-7 / numpy default), on a sorted array. */
export function percentileOf(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo)
}

const statsSchema = z.object({ numbers: z.string() })
export const stats: ToolPlugin = {
  metadata: metaFor('stats'),
  schema: statsSchema,
  run: (input) => {
    const values = parseNumbers(statsSchema.parse(input).numbers)
    if (!values.length) throw new Error('No numbers found — paste values separated by spaces, commas, or newlines.')
    const sorted = [...values].sort((a, b) => a - b)
    const n = sorted.length
    const sum = sorted.reduce((a, b) => a + b, 0)
    const mean = sum / n
    // Sample variance (n−1): a pasted list is nearly always a sample of requests,
    // not the whole population. One value has no spread to report.
    const variance = n > 1 ? sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0
    const stdDev = Math.sqrt(variance)
    const q1 = percentileOf(sorted, 25)
    const q3 = percentileOf(sorted, 75)
    return {
      Count: String(n),
      Sum: num(sum),
      Mean: num(mean),
      Median: num(percentileOf(sorted, 50)),
      Min: num(sorted[0]!),
      Max: num(sorted[n - 1]!),
      Range: num(sorted[n - 1]! - sorted[0]!),
      p75: num(q3),
      p90: num(percentileOf(sorted, 90)),
      p95: num(percentileOf(sorted, 95)),
      p99: num(percentileOf(sorted, 99)),
      'Std deviation': num(stdDev),
      Variance: num(variance),
      'Interquartile range': num(q3 - q1),
      // Spread relative to size, so two datasets of different magnitudes can
      // still be compared for volatility.
      'Coefficient of variation': mean === 0 ? '—' : `${round((stdDev / Math.abs(mean)) * 100)}%`,
      // Tukey's rule: the conventional "unusually far from the middle" cut-off.
      Outliers: String(sorted.filter((v) => v < q1 - 1.5 * (q3 - q1) || v > q3 + 1.5 * (q3 - q1)).length),
    }
  },
}

// --- Uptime / SLA ------------------------------------------------------------

// Labelled in plain days rather than "month"/"quarter": an SLA month is 30 days
// whatever the calendar says, and spelling it out avoids arguing about February.
const SLA_WINDOWS = {
  '24 hours': 86_400,
  '7 days': 604_800,
  '30 days': 2_592_000,
  '90 days': 7_776_000,
  '365 days': 31_536_000,
} as const

const slaSchema = z.object({
  uptime: z.number().min(0).max(100).default(99.9),
  budgetWindow: z.enum(['24 hours', '7 days', '30 days', '90 days', '365 days']).default('30 days'),
  downtimeMinutes: z.number().min(0).default(0),
})
export const slaUptime: ToolPlugin = {
  metadata: metaFor('sla-uptime'),
  schema: slaSchema,
  run: (input) => {
    const { uptime, budgetWindow, downtimeMinutes } = slaSchema.parse(input)
    const unavailable = (100 - uptime) / 100
    const out: Record<string, string> = {
      Availability: `${uptime}%`,
      Nines: unavailable <= 0 ? '∞ (no downtime allowed)' : `${round(-Math.log10(unavailable), 2)} nines`,
    }
    for (const [label, seconds] of Object.entries(SLA_WINDOWS)) {
      out[`Allowed downtime · per ${label}`] = unavailable === 0 ? '0s' : humanDuration(seconds * unavailable)
    }

    const windowSeconds = SLA_WINDOWS[budgetWindow]
    const budget = windowSeconds * unavailable
    const used = downtimeMinutes * 60
    out['Error budget window'] = budgetWindow
    // Percent used is what the bar above the table draws; keep it a plain number
    // with a % so both the reader and the visual can use it.
    out['Budget used'] = budget === 0 ? (used > 0 ? '100%' : '0%') : `${round((used / budget) * 100)}%`
    out['Budget remaining'] = humanDuration(Math.max(0, budget - used))
    out['Actual availability'] = `${round(100 - (used / windowSeconds) * 100, 4)}%`
    out.Status = used > budget ? '⚠ SLA breached' : '✓ Within SLA'
    return out
  },
}

// --- Number bases ------------------------------------------------------------

const BASE_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

const baseSchema = z.object({
  value: z.string(),
  from: z.enum(['auto', '2', '8', '10', '16', '36']).default('auto'),
})
export const baseConverter: ToolPlugin = {
  metadata: metaFor('base-converter'),
  schema: baseSchema,
  run: (input) => {
    const { value, from } = baseSchema.parse(input)
    // Ignore the separators people paste with: 1_000_000, "1010 1100", 0xFF.
    const raw = value.trim().replace(/[\s_,]/g, '')
    if (!raw) throw new Error('Enter a number.')
    const negative = raw.startsWith('-')
    const body = negative ? raw.slice(1) : raw

    const prefixed = /^0x/i.test(body) ? 16 : /^0b/i.test(body) ? 2 : /^0o/i.test(body) ? 8 : null
    const digits = (prefixed ? body.slice(2) : body).toLowerCase()
    const radix = from === 'auto' ? (prefixed ?? 10) : Number(from)

    // parseInt stops at the first invalid digit, so "12z" would silently be 12.
    const allowed = BASE_DIGITS.slice(0, radix)
    if (!digits || ![...digits].every((c) => allowed.includes(c)))
      throw new Error(`"${digits || raw}" is not a valid base-${radix} number (digits allowed: ${allowed}).`)

    const abs = Number.parseInt(digits, radix)
    const n = negative ? -abs : abs
    const bin = abs.toString(2)
    const sign = negative ? '-' : ''
    const hex = abs.toString(16).toUpperCase()
    return {
      'Read as': from === 'auto' ? `base ${radix}${prefixed ? ' (from prefix)' : ''}` : `base ${radix}`,
      Decimal: n.toLocaleString('en-US'),
      Hexadecimal: `${sign}0x${hex}`,
      Octal: `${sign}0o${abs.toString(8)}`,
      // Grouped in nibbles: reading a 16-bit mask off an unbroken run is painful.
      Binary: `${sign}0b${(bin.match(/.{1,4}(?=(?:.{4})*$)/g) ?? [bin]).join(' ')}`,
      Base36: `${sign}${abs.toString(36).toUpperCase()}`,
      'Bit length': `${bin.length} bits`,
      'Fits in': abs < 2 ** 8 ? 'uint8' : abs < 2 ** 16 ? 'uint16' : abs < 2 ** 32 ? 'uint32' : abs <= Number.MAX_SAFE_INTEGER ? '53-bit (JS safe integer)' : 'exceeds JS safe integers — digits beyond 2^53 are unreliable',
      Bytes: hex.padStart(Math.ceil(bin.length / 8) * 2, '0').match(/.{2}/g)!.join(' '),
    }
  },
}

// --- Aspect ratio ------------------------------------------------------------

const NAMED_RATIOS: [number, string][] = [
  [16 / 9, '16:9 — HD video, most displays'],
  [4 / 3, '4:3 — classic TV, iPad'],
  [21 / 9, '21:9 — ultrawide'],
  [1, '1:1 — square'],
  [3 / 2, '3:2 — 35mm photo'],
  [16 / 10, '16:10 — many laptops'],
  [9 / 16, '9:16 — vertical video, phone'],
  [2.39, '2.39:1 — anamorphic cinema'],
]

const aspectSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  targetWidth: z.number().min(0).default(0),
  targetHeight: z.number().min(0).default(0),
})
export const aspectRatio: ToolPlugin = {
  metadata: metaFor('aspect-ratio'),
  schema: aspectSchema,
  run: (input) => {
    const { width, height, targetWidth, targetHeight } = aspectSchema.parse(input)
    const [w, h] = [Math.round(width), Math.round(height)]
    const divisor = gcd(w, h) || 1
    const ratio = width / height
    const closest = NAMED_RATIOS.reduce((best, r) => (Math.abs(r[0] - ratio) < Math.abs(best[0] - ratio) ? r : best))
    const out: Record<string, string> = {
      Ratio: `${w / divisor}:${h / divisor}`,
      Decimal: `${num(ratio, 4)}:1`,
      'Closest standard': `${closest[1]}${Math.abs(closest[0] - ratio) < 0.001 ? ' (exact)' : ''}`,
      Orientation: ratio > 1 ? 'Landscape' : ratio < 1 ? 'Portrait' : 'Square',
      Size: `${w} × ${h}`,
      Pixels: (width * height).toLocaleString('en-US'),
      Megapixels: num((width * height) / 1e6, 2),
      'Height as % of width': `${round((height / width) * 100)}%`,
    }
    // Scaling is the actual reason to open this tool — the ratio is the by-product.
    if (targetWidth > 0) out['Scaled to width'] = `${Math.round(targetWidth)} × ${Math.round(targetWidth / ratio)}`
    if (targetHeight > 0) out['Scaled to height'] = `${Math.round(targetHeight * ratio)} × ${Math.round(targetHeight)}`
    if (targetWidth > 0 && targetHeight > 0) {
      const contain = Math.min(targetWidth / width, targetHeight / height)
      const cover = Math.max(targetWidth / width, targetHeight / height)
      out['Fit inside box (contain)'] = `${Math.round(width * contain)} × ${Math.round(height * contain)}`
      out['Fill box (cover, crops)'] = `${Math.round(width * cover)} × ${Math.round(height * cover)}`
    }
    return out
  },
}

// --- Transfer time -----------------------------------------------------------

const SIZE_UNITS = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 } as const
// Bit rates are decimal by convention (1 Mbps = 1,000,000 bits/s); byte rates are
// what a download UI shows. Both, because people quote both — and confuse them.
const SPEED_UNITS = { Kbps: 125, Mbps: 125_000, Gbps: 125_000_000, 'KB/s': 1e3, 'MB/s': 1e6 } as const
const COMMON_SPEEDS: [string, number][] = [
  ['10 Mbps', 1_250_000],
  ['100 Mbps', 12_500_000],
  ['1 Gbps', 125_000_000],
  ['10 Gbps', 1_250_000_000],
]

const transferSchema = z.object({
  size: z.number().positive(),
  sizeUnit: z.enum(['KB', 'MB', 'GB', 'TB']).default('GB'),
  speed: z.number().positive(),
  speedUnit: z.enum(['Kbps', 'Mbps', 'Gbps', 'KB/s', 'MB/s']).default('Mbps'),
  efficiency: z.number().min(1).max(100).default(100),
})
export const transferTime: ToolPlugin = {
  metadata: metaFor('transfer-time'),
  schema: transferSchema,
  run: (input) => {
    const { size, sizeUnit, speed, speedUnit, efficiency } = transferSchema.parse(input)
    const bytes = size * SIZE_UNITS[sizeUnit]
    const bytesPerSecond = speed * SPEED_UNITS[speedUnit] * (efficiency / 100)
    const seconds = bytes / bytesPerSecond
    const out: Record<string, string> = {
      'Transfer time': humanDuration(seconds),
      'Exact seconds': num(seconds, 2),
      'Effective speed': `${num(bytesPerSecond / 1e6, 2)} MB/s · ${num((bytesPerSecond * 8) / 1e6, 2)} Mbps`,
      'Total size': `${num(bytes, 0)} bytes · ${human(bytes, 1000, BYTE_UNITS)}`,
    }
    for (const [label, bps] of COMMON_SPEEDS) out[`At ${label}`] = humanDuration(bytes / (bps * (efficiency / 100)))
    return out
  },
}

export const mathTools = [percentage, eta, byteConverter, stats, slaUptime, baseConverter, aspectRatio, transferTime]
