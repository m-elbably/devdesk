/**
 * Types shared across the AI layer. Framework-independent: no Vue, no DOM,
 * no Node — this package is bundled into the webview like `@devdesk/sync`.
 */

/** Which wire format a provider speaks. Everything except Gemini is OpenAI-compatible. */
export type ProviderKind = 'lmstudio' | 'ollama' | 'deepseek' | 'openai' | 'gemini' | 'custom'

/**
 * How a provider's HTTP is issued.
 * - `fetch`   — the webview's own fetch. Streams, but is subject to CORS.
 * - `native`  — Neutralino's C++ `net.request`. Ignores CORS, but cannot stream.
 * - `auto`    — try fetch, fall back to native once a CORS rejection is seen.
 */
export type TransportKind = 'auto' | 'fetch' | 'native'

/**
 * Whether a provider runs on this machine. **Derived from the base URL, never
 * set by the user** — it gates which tools may be exposed, so it must not be
 * something a config file can lie about.
 */
export type Locality = 'local' | 'remote'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  /** Display name. Defaults to the preset's label. */
  label: string
  /** OpenAI-compatible base URL, e.g. http://localhost:1234/v1 */
  baseUrl: string
  /** Empty for local providers that need no auth. Never synced, never exported. */
  apiKey: string
  /** Model id last chosen for this provider. */
  model: string
  transport: TransportKind
  /** Strip secrets from outbound text. Defaults on for remote providers. */
  redact: boolean
}

export interface ModelInfo {
  id: string
  /** Present on some OpenAI-compatible servers; absent on others. */
  ownedBy?: string
}

/** A tool call the model made, as surfaced to the UI. */
export interface ToolCallRecord {
  id: string
  toolId: string
  toolName: string
  input: unknown
  output?: unknown
  error?: string
  /** Where the tool ran. Always 'local' — tools are pure functions run in-process. */
  ranLocally: true
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  toolCalls?: ToolCallRecord[]
  createdAt: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}
