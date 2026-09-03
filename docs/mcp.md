# MCP server

`apps/mcp-server` serves DevDesk's tools over [MCP](https://modelcontextprotocol.io) on stdio, so
Claude Code, Cursor, or any MCP-speaking agent can call the same implementations the app runs.

This is the inverse of the in-app assistant: instead of DevDesk hosting a model, an external agent
uses DevDesk's toolbox.

## Build and run

```bash
pnpm --filter @devdesk/mcp build     # bundles to apps/mcp-server/dist/index.js
node apps/mcp-server/dist/index.js --list
```

| Flag | Effect |
| --- | --- |
| `--list` | Print the tools that would be exposed (`id`, privacy level, name), then exit |
| `--public-only` | Expose only `PUBLIC` tools — 53 of 71 |
| `--help` | Usage |

With no flags it speaks MCP on stdin/stdout. Human-readable output goes to stderr; stdout carries
the protocol and nothing else.

## Wiring it up

```json
{
  "mcpServers": {
    "devdesk": {
      "command": "node",
      "args": ["/absolute/path/to/devdesk/apps/mcp-server/dist/index.js"]
    }
  }
}
```

For Claude Code, `claude mcp add devdesk -- node /absolute/path/to/apps/mcp-server/dist/index.js`.

## Privacy

All 71 tools are exposed by default, and that is deliberate: the server talks over a pipe to a
client on the same machine and makes no network requests of its own, so the privacy levels have
nothing to protect against.

Pass `--public-only` when the agent on the other end sends tool inputs and outputs to a cloud model.
It applies the same gate the app's own cloud path uses, through the same function, so the JWT Parser
and friends are simply not in the list.

Either way each tool's description states its privacy level, so a client that routes some work to a
cloud model and some locally can make that call itself.

## Notes

- Tools are pure functions. Every one is annotated `readOnlyHint` and `openWorldHint: false`: same
  input, same output, no writes, no network.
- Zod schemas go straight into MCP's `inputSchema`, so there is no second schema to maintain.
- A bad argument comes back as a tool error, not a dropped connection.
- This is the only package in the repo with a real build step. Everything else is source-linked
  TypeScript that Vite bundles; here esbuild produces one self-contained file that Node can run from
  anywhere.
