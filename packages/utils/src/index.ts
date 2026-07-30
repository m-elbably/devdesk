/** Framework-independent helpers. No DOM, no Vue, no Node-only APIs. */
export * from './emitter'


/** RFC 4122 v4 id. Uses the platform crypto (browser, Workers, Node 20+ all expose it). */
export const newId = (): string => crypto.randomUUID()

export const nowIso = (): string => new Date().toISOString()

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max)

const RELATIVE_UNITS = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
] as const
// 'always', not 'auto': "expires next year" hides how far away that is, and
// these are deadlines people are trying to read precisely. "in 1 year" it is.
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
/**
 * "in 3 days" / "2 hours ago" for an epoch-seconds instant — how JWT `exp` and
 * certificate validity dates want to be read. Rounds before picking a unit so a
 * timestamp exactly an hour out doesn't render as "in 60 minutes".
 */
export function relativeTime(epochSeconds: number): string {
  const diff = Math.round(epochSeconds - Date.now() / 1000)
  const [unit, size] = RELATIVE_UNITS.find(([, s]) => Math.abs(diff) >= s) ?? (['second', 1] as const)
  return relativeFormat.format(Math.round(diff / size), unit)
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export function groupBy<T, K extends string | number>(
  items: readonly T[],
  key: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const item of items) {
    const k = key(item)
    ;(out[k] ??= []).push(item)
  }
  return out
}

/** Naive subsequence fuzzy match with a score (lower = better). Returns null on no match. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q === '') return 0
  let ti = 0
  let score = 0
  let lastHit = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    if (lastHit !== -1) score += found - lastHit // reward adjacency
    lastHit = found
    ti = found + 1
  }
  return score
}
