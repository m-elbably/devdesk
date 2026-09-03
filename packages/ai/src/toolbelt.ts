import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { canSendToRemoteModel } from '@devdesk/shared'
import type { ToolDefinition, ToolPlugin } from '@devdesk/shared'
import { getPlugin, getTool, implementedTools } from '@devdesk/tools'
import { fuzzyScore } from '@devdesk/utils'
import type { Locality } from './types'

/**
 * Tools the agent never gets, for reasons unrelated to privacy.
 *
 * `rsa-keypair` generates a large modulus; the app deliberately runs it in a Web
 * Worker with a 20s timeout because it blocks the window, so it has no business
 * blocking an agent turn either. The two UI-only tools (`gradient-generator`,
 * `image-converter`) have no headless plugin at all — `getPlugin` returns nothing.
 */
export const AGENT_EXCLUDED_TOOL_IDS = new Set(['rsa-keypair'])

/** Default number of tool definitions sent per request. See `selectRelevant`. */
export const DEFAULT_TOOL_CAP = 10

/** A minimal view of a tool's UI spec — enough to describe its fields to a model. */
export interface ToolUiHint {
  fields: Array<{
    kind: string
    name: string
    label: string
    options?: string[]
  }>
}

export type ToolUiHints = Record<string, ToolUiHint | undefined>

export interface ToolbeltOptions {
  /** Where the model runs. `remote` withholds everything but PUBLIC tools. */
  locality: Locality
  /** The user's message, used to rank tools. Empty means "no ranking, take the cap". */
  query?: string
  /** Tool ids already used in this conversation; always included, they cost nothing new. */
  pinned?: readonly string[]
  /** Max tools to expose. See `selectRelevant` for why this matters. */
  cap?: number
  /** Per-tool UI specs, passed in so this package stays independent of the desktop app. */
  uiHints?: ToolUiHints
}

/** A tool that was withheld, and why — the UI shows this rather than silently dropping it. */
export interface WithheldTool {
  id: string
  name: string
  reason: 'privacy'
  privacyLevel: ToolDefinition['privacyLevel']
}

export interface Toolbelt {
  tools: ToolSet
  /** Tool ids actually exposed, in the order they were selected. */
  included: string[]
  /** Tools a local model would have been given but this remote one was not. */
  withheld: WithheldTool[]
}

/** Tools that are runnable at all: implemented, with a real headless plugin behind them. */
export function runnableTools(): ToolDefinition[] {
  return implementedTools().filter(
    (meta) => !AGENT_EXCLUDED_TOOL_IDS.has(meta.id) && getPlugin(meta.id) !== undefined,
  )
}

/**
 * The privacy gate.
 *
 * A local model gets the whole toolbox — nothing leaves the machine, so there is
 * nothing to withhold. A remote model gets only `PUBLIC` tools: a `NEVER_PERSIST`
 * tool like the JWT parser exists precisely so secrets are not written down, and
 * handing one to a third-party API would defeat it entirely.
 */
export function partitionByPrivacy(
  candidates: readonly ToolDefinition[],
  locality: Locality,
): { allowed: ToolDefinition[]; withheld: WithheldTool[] } {
  if (locality === 'local') return { allowed: [...candidates], withheld: [] }

  const allowed: ToolDefinition[] = []
  const withheld: WithheldTool[] = []
  for (const meta of candidates) {
    if (canSendToRemoteModel(meta.privacyLevel)) allowed.push(meta)
    else withheld.push({ id: meta.id, name: meta.name, reason: 'privacy', privacyLevel: meta.privacyLevel })
  }
  return { allowed, withheld }
}

/**
 * Words that carry no signal about which tool is wanted. Short and deliberately
 * incomplete — this is a relevance heuristic, not a language model.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from',
  'get', 'give', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my',
  'need', 'of', 'on', 'or', 'out', 'please', 'so', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'this', 'to', 'too', 'up', 'use', 'want', 'was', 'we', 'what', 'when',
  'where', 'which', 'why', 'will', 'with', 'you', 'your',
])

/** Split a message into the words worth matching on. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 2 && !STOPWORDS.has(term)),
    ),
  ]
}

/**
 * How well one tool answers to one word.
 *
 * Weighted by *where* the word hits: a tool's name and its keywords were written to
 * say what it is, so a hit there is a real signal. A hit in the description is weak
 * — half the descriptions contain "convert" — and a fuzzy subsequence hit is weaker
 * still, worth just enough to break a tie and to survive a typo.
 */
function scoreTerm(meta: ToolDefinition, term: string): number {
  const name = meta.name.toLowerCase()
  if (name === term) return 10
  if (name.split(/[^a-z0-9]+/).includes(term)) return 8
  if (name.includes(term)) return 6

  const labels = [...meta.keywords, ...meta.tags].map((k) => k.toLowerCase())
  if (labels.includes(term)) return 6
  if (labels.some((label) => label.includes(term))) return 4

  if (meta.description.toLowerCase().includes(term)) return 2

  // Last resort: the subsequence match the command palette uses, so a typo or a
  // truncated word still finds its tool. Only counted for terms long enough that a
  // subsequence match means something.
  if (term.length >= 4 && fuzzyScore(term, name) !== null) return 1

  return 0
}

export function scoreToolForQuery(meta: ToolDefinition, terms: readonly string[]): number {
  let total = 0
  for (const term of terms) total += scoreTerm(meta, term)
  return total
}

/**
 * Narrow the belt to what this message plausibly needs.
 *
 * Sending all ~70 definitions costs roughly 5-6k tokens on *every* request, which a
 * local 7B model with an 8k window cannot afford - and local models are the default
 * here. So the belt is ranked and capped per turn.
 *
 * The ranking is word-based rather than the command palette's `searchTools`, which
 * matches the query as one subsequence including its spaces. That is right for
 * something typed a character at a time and wrong for a sentence: "base64 encode
 * this" matches nothing at all, because no single field contains those characters in
 * that order. Scoring each word separately against the fields is what a sentence
 * needs; `fuzzyScore` is still reused underneath for typo tolerance.
 *
 * Pinned tools (already used in this conversation) always survive, above the cap if
 * need be: the model has seen them, and withdrawing one mid-conversation makes its
 * own earlier tool calls unreadable to it.
 */
export function selectRelevant(
  allowed: readonly ToolDefinition[],
  query: string,
  pinned: readonly string[],
  cap: number,
): ToolDefinition[] {
  const byId = new Map(allowed.map((meta) => [meta.id, meta]))
  const picked: ToolDefinition[] = []
  const seen = new Set<string>()

  const take = (meta: ToolDefinition | undefined) => {
    if (!meta || seen.has(meta.id)) return
    seen.add(meta.id)
    picked.push(meta)
  }

  for (const id of pinned) take(byId.get(id))

  const terms = queryTerms(query)
  const ranked =
    terms.length === 0
      ? // Nothing to rank against: fall back to the catalog's curated order.
        [...allowed]
      : allowed
          .map((meta) => ({ meta, score: scoreToolForQuery(meta, terms) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.meta.name.localeCompare(b.meta.name))
          .map((entry) => entry.meta)

  for (const meta of ranked) {
    if (picked.length >= cap) break
    take(meta)
  }

  // Top the belt up to the cap in catalog order. The cap is a token budget, not a
  // target to undershoot: a vague question ("what can you do here?") ranks almost
  // nothing, and a nearly-empty belt leaves the model unable to help with a request
  // this crude heuristic simply failed to classify.
  for (const meta of allowed) {
    if (picked.length >= cap) break
    take(meta)
  }

  return picked
}

/**
 * Describe a tool to the model.
 *
 * The Zod schema gives the model the shape, but most of these schemas are terse
 * (`z.object({ text: z.string() })`) and say nothing about intent. The UI spec
 * already carries human field labels and the option lists for every `select`,
 * written for people — so it doubles as the best available description of what
 * each argument means.
 */
export function describeTool(meta: ToolDefinition, hint?: ToolUiHint): string {
  const parts = [meta.description]

  if (hint?.fields.length) {
    const fields = hint.fields.map((field) => {
      const options = field.options?.length ? ` (one of: ${field.options.join(', ')})` : ''
      return `${field.name} — ${field.label}${options}`
    })
    parts.push(`Arguments: ${fields.join('; ')}.`)
  }

  if (meta.keywords.length) parts.push(`Also known as: ${meta.keywords.join(', ')}.`)

  return parts.join(' ')
}

/**
 * Build the tool set handed to the model: privacy gate first, then relevance.
 *
 * Order matters. Filtering by privacy before ranking means a withheld tool can
 * never be surfaced by a well-chosen query, and the `withheld` list reflects
 * everything the gate stopped rather than only what happened to rank highly.
 */
export function buildToolbelt(options: ToolbeltOptions): Toolbelt {
  const { locality, query = '', pinned = [], cap = DEFAULT_TOOL_CAP, uiHints = {} } = options

  const { allowed, withheld } = partitionByPrivacy(runnableTools(), locality)
  const selected = selectRelevant(allowed, query, pinned, cap)

  const tools: ToolSet = {}
  for (const meta of selected) {
    const plugin = getPlugin(meta.id) as ToolPlugin | undefined
    if (!plugin) continue
    tools[toolNameFor(meta.id)] = tool({
      description: describeTool(meta, uiHints[meta.id]),
      inputSchema: plugin.schema,
      execute: async (input: unknown) => await plugin.run(input),
    })
  }

  return { tools, included: selected.map((meta) => meta.id), withheld }
}

/**
 * Tool ids are kebab-case but some providers only accept `[A-Za-z0-9_-]` and are
 * happier with underscores, so the wire name is normalised and mapped back.
 */
export const toolNameFor = (toolId: string): string => toolId.replace(/-/g, '_')

export const toolIdFor = (toolName: string): string | undefined => {
  const direct = getTool(toolName)
  if (direct) return direct.id
  const dashed = toolName.replace(/_/g, '-')
  return getTool(dashed)?.id
}
