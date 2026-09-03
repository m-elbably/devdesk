import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { canSendToRemoteModel } from '@devdesk/shared'
import type { ToolDefinition } from '@devdesk/shared'
import { allTools, getPlugin, implementedTools, registerBuiltinTools } from '@devdesk/tools'
import { z } from 'zod'

export interface ServerOptions {
  /**
   * Expose only `PUBLIC` tools.
   *
   * Off by default, and that is the right default: this server speaks stdio to a
   * client on the same machine and initiates no network traffic of its own, so the
   * privacy levels have nothing to protect against here. Turn it on when the harness
   * on the other end of the pipe is itself a cloud model, which puts the tool's
   * inputs and outputs in someone else's transcript — the same boundary the app's
   * own assistant applies, through the same function.
   */
  publicOnly?: boolean
}

export const SERVER_NAME = 'devdesk'
export const SERVER_VERSION = '1.0.0'

/** Tools with a headless plugin behind them, which is what can be called at all. */
export function runnableTools(): ToolDefinition[] {
  ensureToolsRegistered()
  return implementedTools().filter((meta) => getPlugin(meta.id) !== undefined)
}

export function exposedTools(options: ServerOptions = {}): ToolDefinition[] {
  const tools = runnableTools()
  return options.publicOnly ? tools.filter((meta) => canSendToRemoteModel(meta.privacyLevel)) : tools
}

/**
 * Describe a tool to the client.
 *
 * The privacy level is stated rather than merely enforced: a client deciding what to
 * put in front of a cloud model can only respect a boundary it has been told about.
 */
export function describeTool(meta: ToolDefinition): string {
  const parts = [meta.description]
  if (meta.keywords.length) parts.push(`Also known as: ${meta.keywords.join(', ')}.`)
  if (meta.privacyLevel !== 'PUBLIC') {
    parts.push(
      `Privacy: ${meta.privacyLevel}. DevDesk does not persist or transmit this tool's data; treat its inputs and outputs as sensitive.`,
    )
  }
  return parts.join(' ')
}

/**
 * The MCP SDK wants a raw shape (`{ field: ZodType }`) so it can build the JSON
 * Schema clients see. Every plugin schema is a ZodObject today; anything else is
 * exposed without a declared shape rather than being dropped.
 */
function inputShape(schema: unknown): Record<string, z.ZodTypeAny> | undefined {
  const shape = (schema as { shape?: unknown })?.shape
  return shape && typeof shape === 'object' ? (shape as Record<string, z.ZodTypeAny>) : undefined
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

/**
 * Populate the tool registry, once.
 *
 * `registerBuiltinTools` throws on a second call — it guards against a tool being
 * registered twice — so building two servers in one process (a test, or a host that
 * restarts the server) would fail without this check.
 */
export function ensureToolsRegistered(): void {
  if (allTools().length === 0) registerBuiltinTools()
}

/** Build the server with every exposed tool registered. */
export function createServer(options: ServerOptions = {}): McpServer {
  ensureToolsRegistered()

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  for (const meta of exposedTools(options)) {
    const plugin = getPlugin(meta.id)
    if (!plugin) continue

    const shape = inputShape(plugin.schema)

    server.registerTool(
      meta.id,
      {
        title: meta.name,
        description: describeTool(meta),
        ...(shape ? { inputSchema: shape } : {}),
        annotations: {
          // Every DevDesk tool is a pure function: same input, same output, no writes.
          readOnlyHint: true,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          const output = await plugin.run(args)
          return { content: [{ type: 'text' as const, text: asText(output) }] }
        } catch (error) {
          // Reported as a tool error rather than thrown: a bad argument is the
          // model's to correct, and killing the connection over one is unhelpful.
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  }

  return server
}
