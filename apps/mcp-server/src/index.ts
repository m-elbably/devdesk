import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer, ensureToolsRegistered, exposedTools, runnableTools, SERVER_NAME, SERVER_VERSION } from './server.js'

export * from './server.js'

const USAGE = `${SERVER_NAME} ${SERVER_VERSION} — DevDesk's developer tools over MCP (stdio).

Usage: devdesk-mcp [options]

  --public-only   Expose only tools marked PUBLIC. Use this when the client on the
                  other end sends tool inputs and outputs to a cloud model.
  --list          Print the tools that would be exposed, then exit.
  --help          Show this message.
`

async function main(argv: string[]): Promise<void> {
  ensureToolsRegistered()
  const publicOnly = argv.includes('--public-only')

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return
  }

  if (argv.includes('--list')) {
    const tools = exposedTools({ publicOnly })
    for (const meta of tools) process.stdout.write(`${meta.id}\t${meta.privacyLevel}\t${meta.name}\n`)
    process.stderr.write(`${tools.length} of ${runnableTools().length} tools exposed.\n`)
    return
  }

  const server = createServer({ publicOnly })

  // stdout carries the protocol and nothing else — every human-readable line goes
  // to stderr, or it corrupts the stream.
  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} ready on stdio — ${exposedTools({ publicOnly }).length} tools` +
      `${publicOnly ? ' (PUBLIC only)' : ''}.\n`,
  )

  await server.connect(new StdioServerTransport())
}

// Only run when executed directly, so the module can be imported by tests.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { main }
