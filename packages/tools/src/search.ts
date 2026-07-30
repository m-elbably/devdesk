import { fuzzyScore } from '@devdesk/utils'
import type { ToolCategory, ToolDefinition } from '@devdesk/shared'
import { allTools } from './registry'

export interface ToolSearchOptions {
  category?: ToolCategory
  tags?: string[]
  /** Include disabled "coming soon" tools in results. Default true. */
  includePlaceholders?: boolean
}

/** Rank a tool against a query across name, description, keywords and tags. */
function scoreTool(tool: ToolDefinition, query: string): number | null {
  const haystacks = [tool.name, tool.description, ...tool.keywords, ...tool.tags]
  let best: number | null = null
  for (const h of haystacks) {
    const s = fuzzyScore(query, h)
    if (s !== null && (best === null || s < best)) best = s
  }
  return best
}

/**
 * Filter + rank tools. Empty query returns everything (respecting filters),
 * name-sorted; a query returns fuzzy-ranked matches best-first.
 */
export function searchTools(query: string, opts: ToolSearchOptions = {}): ToolDefinition[] {
  const { category, tags, includePlaceholders = true } = opts

  let pool = allTools()
  if (category) pool = pool.filter((t) => t.category === category)
  if (!includePlaceholders) pool = pool.filter((t) => t.isImplemented)
  if (tags?.length) pool = pool.filter((t) => tags.every((tag) => t.tags.includes(tag)))

  const q = query.trim()
  if (q === '') return pool.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))

  return pool
    .map((tool) => ({ tool, score: scoreTool(tool, q) }))
    .filter((r): r is { tool: ToolDefinition; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((r) => r.tool)
}
