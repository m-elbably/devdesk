# AI assistant

DevDesk's assistant does not answer from the model's own knowledge. It picks one of the 71
implemented tools, DevDesk runs the real implementation, and the tool's output is the answer. Ask it
to work out how many hosts fit in a `/22` and you get the CIDR Calculator's arithmetic, not the
model's.

Everything here is optional and off until you configure it.

## Setting it up

Open the panel with **Ctrl/Cmd+I**, or the sparkle button in the header.

### A model on your own machine (recommended)

Start [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com) with a tool-calling model
loaded, then open the panel. DevDesk probes `localhost:1234` and `localhost:11434` and configures
whichever answers. Nothing you type leaves your machine, and the assistant is offered every tool.

Both servers refuse browser origins by default, and DevDesk is served from one:

| Server | What to do |
| --- | --- |
| LM Studio | `lms server start --cors`, or tick **Enable CORS** in Developer → Server Settings |
| Ollama | restart with `OLLAMA_ORIGINS=*` (or just this app's origin) |

If a request is refused you get that instruction, not a bare `Failed to fetch`.

### A cloud provider

**Settings → AI assistant → Add provider**, then pick DeepSeek, OpenAI, Google Gemini, or a custom
OpenAI-compatible endpoint, and paste an API key. Read [what a cloud provider
sees](#what-a-cloud-provider-sees) first.

## What a cloud provider sees

This is the part worth understanding, because it is enforced in code rather than promised.

Every tool declares a privacy level. `LOCAL_ONLY` means its data never leaves the device;
`NEVER_PERSIST` means it is never even written down. Neither may be handed to a third-party API, so
when the active provider is remote:

- **Only `PUBLIC` tools are offered to it.** The JWT Parser, Password Generator, Encryption tool and
  the rest are not in the list the model receives — it cannot call what it cannot see. The panel
  names what was withheld rather than dropping it silently.
- **Page context is refused.** The chips above the composer stop being clickable and say why.
- **Outbound text is redacted** by default: values after `api_key`, `password`, `secret` and `token`,
  and `Authorization: Bearer` headers. That is a backstop, not the boundary.

A **local** provider is offered the whole toolbox, because nothing leaves the machine.

Whether a provider is local is derived from its URL — loopback, `.local`, a private range, or an
IPv6 unique-local address — and never from what its configuration claims. It **fails closed**:
anything not provably on this machine, including a URL that will not parse, counts as remote.

## Where your keys live

API keys are stored in a local-only table (`aiProviders`) that is deliberately absent from the sync
system's entity map, so they are never pushed to a sync server. They are also stripped from database
backups: export one and the key comes back as an empty string.

## Tools per message

The model is shown a ranked subset of the toolbox rather than all 71 definitions, which would cost
5–6k tokens on every request and choke a 7B model with an 8k window. Tools are ranked against your
question and topped up to the cap, and any tool already used in the conversation stays.

If the assistant misses a tool it should have found, raise **Tools per message** in Settings. If a
small local model starts losing track, lower it.

## Streaming, and when it isn't available

Replies stream token by token over the normal path. Some providers — `api.openai.com` among them —
send no CORS headers at all, so a direct browser request can never succeed. In the packaged app
DevDesk retries through Neutralino's native HTTP bridge, which runs in C++ where CORS does not
apply. That path buffers the whole response, so the reply arrives at once instead of streaming; the
panel says so when it happens.

This fallback needs the desktop app. Under `pnpm dev:desktop` there is no Neutralino, so a provider
that blocks browser origins simply cannot be reached.

## Limits

- Tool-calling support among local models is uneven. A model that ignores tools will answer from its
  own knowledge, which is exactly what this feature exists to avoid — prefer a model advertised as
  supporting tool calling.
- A malformed tool call is recovered, not fatal: the model is told what went wrong and gets another
  step, up to a cap.
- Conversation history is replayed as text. Tool results are folded into the assistant's answer
  rather than re-sent, to keep the context budget for the question.
