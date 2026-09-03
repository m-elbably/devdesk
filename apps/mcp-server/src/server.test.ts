import { beforeAll, describe, expect, it } from 'vitest'
import { canSendToRemoteModel } from '@devdesk/shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { getPlugin } from '@devdesk/tools'
import { createServer, describeTool, ensureToolsRegistered, exposedTools, runnableTools } from './server'

beforeAll(ensureToolsRegistered)

describe('exposedTools', () => {
  it('exposes the whole toolbox by default', () => {
    const tools = exposedTools()
    expect(tools).toHaveLength(runnableTools().length)
    expect(tools.length).toBeGreaterThan(50)
  })

  it('includes tools the in-app assistant withholds, because stdio is not the network', () => {
    // Nothing leaves this machine over a pipe, so a NEVER_PERSIST tool is fine here
    // while the app's own cloud path withholds it.
    expect(exposedTools().map((t) => t.id)).toContain('jwt-parser')
  })

  it('applies the same privacy gate as the app under --public-only', () => {
    const tools = exposedTools({ publicOnly: true })

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.length).toBeLessThan(runnableTools().length)
    for (const meta of tools) expect(canSendToRemoteModel(meta.privacyLevel)).toBe(true)
    expect(tools.map((t) => t.id)).not.toContain('jwt-parser')
  })

  it('never exposes a tool with no implementation behind it', () => {
    for (const meta of exposedTools()) {
      expect(getPlugin(meta.id), meta.id).toBeDefined()
    }
    expect(exposedTools().map((t) => t.id)).not.toContain('gradient-generator')
  })
})

describe('describeTool', () => {
  it('says what the tool is for', () => {
    const meta = runnableTools().find((t) => t.id === 'base64')
    expect(describeTool(meta!)).toContain(meta!.description)
  })

  it('tells the client when a tool handles sensitive data', () => {
    // A client choosing what to put in front of a cloud model can only respect a
    // boundary it has been told about.
    const jwt = runnableTools().find((t) => t.id === 'jwt-parser')
    expect(describeTool(jwt!)).toContain('NEVER_PERSIST')
  })

  it('says nothing extra for an ordinary PUBLIC tool', () => {
    const meta = runnableTools().find((t) => t.id === 'base64')
    expect(describeTool(meta!)).not.toContain('Privacy:')
  })
})

describe('createServer', () => {
  it('can be built more than once in a process', () => {
    // registerBuiltinTools throws on a second call, so an unguarded createServer
    // works exactly once — which a host restarting the server would discover.
    expect(() => createServer()).not.toThrow()
    expect(() => createServer()).not.toThrow()
  })

  it('builds without throwing on any tool in the registry', () => {
    expect(() => createServer()).not.toThrow()
    expect(() => createServer({ publicOnly: true })).not.toThrow()
  })
})

/**
 * Driven through a real MCP client over an in-memory pipe rather than by reaching
 * into the server's internals: the thing worth asserting is what a client actually
 * receives, and private field names are the SDK's to change.
 */
async function connect(options: { publicOnly?: boolean } = {}) {
  const server = createServer(options)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, close: () => Promise.all([client.close(), server.close()]) }
}

describe('what a client sees', () => {
  it('lists every exposed tool, with a description and an input schema', async () => {
    const { client, close } = await connect()
    try {
      const { tools } = await client.listTools()

      expect(tools.map((t) => t.name).sort()).toEqual(exposedTools().map((t) => t.id).sort())
      for (const tool of tools) {
        expect(tool.description, tool.name).toBeTruthy()
        expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object' })
      }
    } finally {
      await close()
    }
  })

  it('withholds sensitive tools under --public-only', async () => {
    const { client, close } = await connect({ publicOnly: true })
    try {
      const names = (await client.listTools()).tools.map((t) => t.name)
      expect(names).not.toContain('jwt-parser')
      expect(names).toContain('base64')
    } finally {
      await close()
    }
  })

  it('runs a tool and returns its real output', async () => {
    const { client, close } = await connect()
    try {
      const result = await client.callTool({ name: 'base64', arguments: { text: 'devdesk', mode: 'encode' } })
      const content = result.content as { type: string; text: string }[]

      // The real implementation ran, in process — that is the whole point of this server.
      expect(content[0]?.text).toBe(Buffer.from('devdesk').toString('base64'))
      expect(result.isError).toBeFalsy()
    } finally {
      await close()
    }
  })

  it('runs a tool that returns structured output', async () => {
    const { client, close } = await connect()
    try {
      const result = await client.callTool({ name: 'cidr-calculator', arguments: { cidr: '10.0.0.0/24' } })
      const content = result.content as { type: string; text: string }[]

      expect(content[0]?.text).toContain('10.0.0')
    } finally {
      await close()
    }
  })

  it('reports a bad argument as a tool error rather than dropping the connection', async () => {
    const { client, close } = await connect()
    try {
      const result = await client.callTool({ name: 'json-diff', arguments: { left: 'not json', right: '{}' } })
      expect(result.isError).toBe(true)

      // Still usable afterwards: a bad argument is the model's to correct.
      const after = await client.callTool({ name: 'base64', arguments: { text: 'ok', mode: 'encode' } })
      expect(after.isError).toBeFalsy()
    } finally {
      await close()
    }
  })

  it('refuses a tool that was withheld, rather than running it anyway', async () => {
    const { client, close } = await connect({ publicOnly: true })
    try {
      // The SDK answers an unknown tool with an error result rather than a
      // transport rejection. What matters is that the tool did not run.
      const result = await client.callTool({
        name: 'jwt-parser',
        arguments: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.x' },
      })
      const content = result.content as { type: string; text: string }[]

      expect(result.isError).toBe(true)
      expect(content[0]?.text).toMatch(/jwt-parser/)
      expect(JSON.stringify(content)).not.toContain('secret')
    } finally {
      await close()
    }
  })
})
