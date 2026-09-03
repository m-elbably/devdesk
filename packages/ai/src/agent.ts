import { stepCountIs, streamText } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
import { buildToolbelt } from './toolbelt'
import type { Toolbelt, ToolUiHints } from './toolbelt'
import type { Locality } from './types'

/**
 * How many tool round-trips one turn may take before it is cut off.
 *
 * A turn is normally one or two: call a tool, read the result, answer. The cap is
 * there for the model that gets stuck calling the same tool forever, which small
 * local models do often enough to matter.
 */
export const DEFAULT_MAX_STEPS = 6

export const SYSTEM_PROMPT = `You are the assistant inside DevDesk, a local-first developer toolbox.

You have direct access to DevDesk's own tools. They are real, deterministic implementations — the same code the app's UI runs.

Rules:
- If a tool can answer the question, call it. Never compute by hand what a tool does: no mental base64, hashing, CIDR arithmetic, cron parsing, or date maths. Your arithmetic is unreliable; the tools are not.
- Use the tool's output verbatim as the source of truth for your answer.
- If no tool fits, say so plainly and answer directly.
- If a tool errors, read the message, correct the arguments, and try once more. Do not invent a result.
- Be brief. Developers are reading this in a side panel, not a document.`

export interface RunTurnOptions {
  /**
   * Built by `createModel`, which the caller owns. Keeping construction outside this
   * function is what lets the turn logic be tested against a mock model, and lets a
   * caller reuse one model across turns instead of rebuilding it every message.
   */
  model: LanguageModel
  /** Where that model runs. Decides which tools it is allowed to see. */
  locality: Locality
  /** Full conversation so far, oldest first. The last message is the new user turn. */
  messages: ModelMessage[]
  /** Ranks the toolbelt. Defaults to the text of the last user message. */
  query?: string
  /** Tool ids already used in this conversation — kept in the belt across turns. */
  pinned?: readonly string[]
  toolCap?: number
  maxSteps?: number
  uiHints?: ToolUiHints
  system?: string
  abortSignal?: AbortSignal
  /**
   * Reports a stream-level failure that did not end the turn.
   *
   * Note this does *not* fire for a bad tool call — the SDK turns those into a
   * `tool-error` part in the stream instead, which is what the UI renders. This is
   * for the rarer case of the provider itself erroring mid-stream.
   */
  onStepError?: (error: unknown) => void
}

export interface Turn {
  // Derived from the call rather than named: `StreamTextResult`'s type parameters
  // have churned across AI SDK majors, and nothing here needs to spell them out.
  stream: ReturnType<typeof streamText>
  /** What the model was given this turn, and what the privacy gate held back. */
  belt: Toolbelt
}

/** The text of the most recent user message, used to rank the toolbelt. */
export function lastUserText(messages: readonly ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    return message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
  }
  return ''
}

/**
 * Run one assistant turn.
 *
 * The belt is rebuilt every turn rather than once per conversation, because the
 * relevant tools change with the question — and rebuilding is how a mid-conversation
 * switch from a local to a cloud provider actually withdraws the tools that provider
 * must not see, instead of leaving a stale belt in place.
 *
 * Bad tool calls are recoverable, not fatal. Tool-calling support among local models
 * is uneven, and the usual failure is a hallucinated tool name or arguments that do
 * not fit the schema. Rather than throwing, the SDK emits a `tool-error` part and
 * feeds the complaint back to the model as a failed tool result, so it can correct
 * itself on the next step; the step cap is what stops it going round forever. The UI
 * reads those parts off the stream and renders them as failed tool cards.
 */
export function runTurn(options: RunTurnOptions): Turn {
  const {
    model,
    locality,
    messages,
    query,
    pinned = [],
    toolCap,
    maxSteps = DEFAULT_MAX_STEPS,
    uiHints,
    system = SYSTEM_PROMPT,
    abortSignal,
    onStepError,
  } = options

  const belt = buildToolbelt({
    locality,
    query: query ?? lastUserText(messages),
    pinned,
    ...(toolCap === undefined ? {} : { cap: toolCap }),
    ...(uiHints === undefined ? {} : { uiHints }),
  })

  const stream = streamText({
    model,
    system,
    messages,
    tools: belt.tools,
    stopWhen: stepCountIs(maxSteps),
    ...(abortSignal === undefined ? {} : { abortSignal }),
    onError: ({ error }) => onStepError?.(error),
  })

  return { stream, belt }
}
