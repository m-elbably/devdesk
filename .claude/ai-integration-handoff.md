# AI integration — handoff

Written at the end of the session that built this, so a fresh chat can pick it up without
re-deriving anything. Facts here were verified at commit `f6a6fbf`; re-check anything that
looks stale before relying on it.

## Where things are

| Branch | Commit | What it is |
| --- | --- | --- |
| `main` | `1583cb2` | untouched by this work |
| `development` | `a8420e7` | notebooks, protected/encrypted notes, snippets→notes migration |
| `claude/llm-ai-agents-integration-34ohzu` | `f6a6fbf` | **the AI feature**, with `development` merged in |
| `claude/useassistant-tests` | `f6a6fbf` | fresh branch off the AI branch, nothing on it yet |

No PR is open. `development` is *not* merged into `main`, and the AI branch is *not* merged
into `development`.

Gates at `f6a6fbf`: **428 tests pass, typecheck clean, 0 lint errors** (8 pre-existing
`vue/no-v-html` and `require-default-prop` warnings).

## What shipped

Local-first AI assistant. The model picks a tool and DevDesk runs the real implementation —
the model never computes the answer.

```
packages/ai/                 provider layer, transports, privacy gate, agent loop (98 tests)
  types.ts presets.ts native-fetch.ts models.ts toolbelt.ts agent.ts
apps/mcp-server/             71 tools over MCP stdio, esbuild bundle (15 tests)
apps/desktop/src/
  services/ai.ts             module-singleton service (15 tests)
  features/assistant/        AssistantPanel, MessageList, ToolCallCard, ContextChips,
                             useAssistant, usePageContext, state, toolHandoff (14 tests)
  features/settings/AiProvidersCard.vue
packages/database/src/db.ts  version(4): aiProviders + aiConversations, backup redaction
docs/ai.md docs/mcp.md
```

Providers: LM Studio, Ollama, DeepSeek, OpenAI, Gemini, custom. Built on the Vercel AI SDK
(`ai@7.0.91`); all but Gemini go through `@ai-sdk/openai-compatible`.

## Invariants — do not break these

1. **Locality is derived from the provider URL, never stored or trusted from config.**
   `localityOf()` in `packages/ai/src/presets.ts` fails closed: anything not provably
   loopback / `.local` / RFC1918 / IPv6 ULA — an unparseable URL included — is `remote`.
2. **A remote model is offered only `PUBLIC` tools.** The gate (`partitionByPrivacy`) runs
   *before* relevance ranking, so no well-chosen query can surface a withheld tool. Tested
   against the real registry, queried by tool name.
3. **`aiProviders` / `aiConversations` must stay out of `EntityKind`, `repoByKind` and
   `tableByKind`** (`apps/desktop/src/services/sync.ts`). That absence is the only thing
   keeping API keys off the sync server. A test asserts a provider write leaves the sync
   queue empty.
4. **`REDACTED_FIELDS` in `packages/database/src/db.ts`** strips `apiKey` on backup export.
   `exportBackup` walks tables generically, so a new table joins backups automatically —
   which is exactly why that list must be maintained alongside it.
5. **Page context is re-checked at send time, not just at render.** A context chip ticked
   under a local provider is still dropped if the user switches to a cloud one before
   sending (`AssistantPanel.vue`, `contextBlocked`).
6. **The assistant panel must stay lazy.** `AppLayout.vue` mounts it via
   `defineAsyncComponent` and `v-if`. Verified: the AI SDK lands in its own ~304 KB chunk
   with no `openai-compatible` / `generativelanguage` / `toolCallId` / `ai-sdk` strings in
   the startup chunk. A static import from anything eager undoes this.

## Verified vs not

**Verified by running it:**
- 428 tests, typecheck, lint, both builds.
- AI SDK chunk isolation (grepped the built startup chunk).
- MCP end-to-end over real stdio: 71 tools listed, `jwt-parser` and `cidr-calculator`
  returning correct output; `--public-only` exposes 53.

**Never verified — needs real hardware and a human:**
- **Nothing has talked to a live model.** Every test runs against stubs and the AI SDK's
  mock provider. No LM Studio, Ollama, OpenAI or Gemini endpoint has been contacted.
- The **fetch→native transport fallback** only runs in the packaged binary. `pnpm
  dev:desktop` has no Neutralino, so it cannot be exercised there at all. Needs
  `pnpm build:desktop` and running the real executable with an OpenAI key.
- The **v4 Dexie migration** has never run against a database that already holds data.
- Binary size before/after (`neu build --embed-resources` makes deps executable size).

## Known gaps

- **`useAssistant.ts` has zero test coverage** — 206 lines holding the streaming loop,
  redaction application, tool-call record building, cancel and persistence. `AssistantPanel.test.ts`
  mocks it out entirely. This is what `claude/useassistant-tests` was branched for.
- **Protected notes are a landmine.** `development` added `isProtected` / `encrypted` to
  notes. Nothing leaks today, because `offerContext` is only wired to tool inputs. But the
  moment notes become AI context, a protected note's plaintext must not reach any model.
- **7 unhandled `TooltipProvider` errors** in the desktop smoke test. Pre-existing on
  `development` — confirmed by running that test in a clean worktree of `origin/development`,
  which produces the same 7. Not caused by the AI work.
- Tiptap peer-dependency warnings on install, also pre-existing on `development`.

## Findings worth not rediscovering

- **`searchTools()` cannot rank a sentence.** `fuzzyScore` matches the query as one
  subsequence *including its spaces* — right for a palette typed character by character,
  useless for "base64 encode this", which matched nothing. `toolbelt.ts` scores each word
  separately against name / keywords / tags / description, weighted by where it hits, with
  `fuzzyScore` kept underneath for typos.
- **The belt tops up to the cap.** A weak query used to yield a 2–3 tool belt; the cap is a
  token budget, not a target to undershoot.
- **AI SDK v7:** `tool()` and the `Tool` type *are* re-exported from `ai`, so
  `@ai-sdk/provider-utils` is not needed as a direct dependency. Loop control is
  `stopWhen: stepCountIs(n)`; `maxSteps` is gone.
- **`@ai-sdk/provider` must be a dev dependency of `packages/ai`.** Without it pnpm's strict
  linking leaves the mock model's types silently degraded to `any`, which lets a malformed
  stream part typecheck. In V4 a finish reason is `{ unified, raw }`, not a string, and
  usage is nested — a flat shape silently fails to parse.
- **A malformed tool call is recoverable, not fatal.** The SDK emits a `tool-error` part and
  feeds the complaint back to the model; `onError` does *not* fire for it.
- **Neutralino's `net.request` accepts a body**, verified against `api/net/net.cpp`, not the
  shipped typings — which omit `body`, `contentType`, `allowRedirects` and type `headers` as
  an array when the C++ iterates it as an object. `net.request` is allowlisted in
  `neutralino.config.json` (not `net.*`).
- **CORS matrix:** OpenAI ❌ (no ACAO header, ever), Gemini ✅, LM Studio ✅ with `--cors`,
  Ollama ✅ with `OLLAMA_ORIGINS`. DeepSeek untested.
- **`apps/mcp-server` needs a real bundler.** Every other package is source-linked TS that
  Vite bundles, so `tsc` emitted JS importing a `.ts` file Node cannot run. Two esbuild
  details are load-bearing: the shebang must come from the banner (a second one on line 2 is
  a syntax error), and the banner defines `require` via `createRequire` because node-forge
  calls `require('crypto')` at runtime.
- **`packages/tools/src/tools/tools.test.ts` contains one NUL byte** (a unicode-inspector
  fixture). Edit it in binary mode; a text round-trip destroys it.
- **Dexie versions:** `version(3)` is the notebooks release from `development`; the AI tables
  are `version(4)`. A version's store map must restate *every* table — one left out is a
  store Dexie drops.

## What's next (nothing started)

1. **Test `useAssistant.ts`** — the branch already exists. Drive it against the AI SDK mock
   provider the way `packages/ai/src/agent.test.ts` does.
2. **Inline AI actions in tools** — an "Explain this" action in `ToolRunner`'s output header,
   grounded in the 69 per-tool docs already shipped (`TOOL_INFO` in `apps/desktop/src/tools/info`)
   so explanations cite real semantics. Cheapest remaining item.
3. **Natural-language command palette** — "cidr for 500 hosts" picks the tool and fills the
   arguments; falls back to today's fuzzy search when no provider is configured.
4. **Agents over workspace data** — `features/board/markdownTasks.ts` already parses markdown
   into task shapes; `lib/workspaceActivity.ts` is a head start on "what did I do this week".
   **Handle protected notes before this ships.**
5. **Saved / scheduled agents** — name, system prompt, provider, tool allowlist, privacy
   ceiling. Local-only rows.

Three agent frameworks were evaluated and rejected (TrueForge, Mastra, VoltAgent): all are
Node server frameworks needing `fs` / `child_process` / `async_hooks` / TCP, none of which
exist in a Neutralino webview, and all three are built on the Vercel AI SDK anyway. Mastra
also bundles `posthog-node` telemetry, in an app whose pitch is no telemetry. The evaluation
is what pointed at the MCP server as the right integration direction.

A SQLite migration was researched and deferred; that appendix is in the session plan file, not
here. Short version: the blocker is OPFS support across WebKitGTK / WKWebView / WebView2, not
the WASM payload, and the named Dexie pain may just be `BaseRepository.list()` doing a full
table scan via `.filter()` instead of using the `workspaceId` index.
