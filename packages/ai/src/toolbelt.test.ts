import { beforeAll, describe, expect, it } from 'vitest'
import { canSendToRemoteModel } from '@devdesk/shared'
import { getPlugin, getTool, implementedTools, registerBuiltinTools } from '@devdesk/tools'
import {
  AGENT_EXCLUDED_TOOL_IDS,
  DEFAULT_TOOL_CAP,
  buildToolbelt,
  describeTool,
  partitionByPrivacy,
  runnableTools,
  selectRelevant,
  toolIdFor,
  toolNameFor,
} from './toolbelt'

// Assert against the real registry, not a fixture: the point of these tests is that
// the privacy gate holds for the tools that actually ship, including ones added later.
beforeAll(() => {
  registerBuiltinTools()
})

describe('runnableTools', () => {
  it('only returns tools with a headless plugin behind them', () => {
    for (const meta of runnableTools()) {
      expect(getPlugin(meta.id), `${meta.id} has no plugin`).toBeDefined()
    }
  })

  it('drops UI-only tools, which are implemented but have no plugin', () => {
    const ids = runnableTools().map((meta) => meta.id)
    expect(ids).not.toContain('gradient-generator')
    expect(ids).not.toContain('image-converter')
  })

  it('drops explicitly excluded tools', () => {
    const ids = runnableTools().map((meta) => meta.id)
    for (const excluded of AGENT_EXCLUDED_TOOL_IDS) expect(ids).not.toContain(excluded)
    // Guard against the exclusion silently becoming a no-op if the tool is renamed.
    expect(getTool('rsa-keypair')).toBeDefined()
  })

  it('still leaves a substantial toolbox', () => {
    expect(runnableTools().length).toBeGreaterThan(50)
  })
})

describe('the privacy gate', () => {
  it('withholds nothing from a local model', () => {
    const { allowed, withheld } = partitionByPrivacy(runnableTools(), 'local')
    expect(withheld).toEqual([])
    expect(allowed).toHaveLength(runnableTools().length)
  })

  it('gives a remote model PUBLIC tools only', () => {
    const { allowed, withheld } = partitionByPrivacy(runnableTools(), 'remote')

    expect(allowed.length).toBeGreaterThan(0)
    for (const meta of allowed) expect(meta.privacyLevel).toBe('PUBLIC')
    for (const meta of withheld) expect(meta.privacyLevel).not.toBe('PUBLIC')
    expect(allowed.length + withheld.length).toBe(runnableTools().length)
  })

  it('actually withholds something — the registry has non-PUBLIC tools to withhold', () => {
    const { withheld } = partitionByPrivacy(runnableTools(), 'remote')
    expect(withheld.length).toBeGreaterThan(0)
    // The JWT parser is the canonical case: NEVER_PERSIST exists so a token is not
    // written down, and handing it to a third-party API would defeat that entirely.
    expect(withheld.map((w) => w.id)).toContain('jwt-parser')
  })

  it('reports why each tool was withheld, rather than dropping it silently', () => {
    const { withheld } = partitionByPrivacy(runnableTools(), 'remote')
    for (const entry of withheld) {
      expect(entry.reason).toBe('privacy')
      expect(entry.name).not.toBe('')
      expect(canSendToRemoteModel(entry.privacyLevel)).toBe(false)
    }
  })
})

describe('buildToolbelt', () => {
  it('never exposes a non-PUBLIC tool to a remote model, whatever the query asks for', () => {
    // Query the withheld tools by name: if ranking could defeat the gate, this finds it.
    const secretish = implementedTools().filter((meta) => !canSendToRemoteModel(meta.privacyLevel))
    expect(secretish.length).toBeGreaterThan(0)

    for (const meta of secretish) {
      const belt = buildToolbelt({ locality: 'remote', query: meta.name, cap: 25 })
      expect(belt.included, `${meta.name} leaked into a remote belt`).not.toContain(meta.id)
      expect(Object.keys(belt.tools)).not.toContain(toolNameFor(meta.id))
    }
  })

  it('gives the same query a non-PUBLIC tool when the model is local', () => {
    const belt = buildToolbelt({ locality: 'local', query: 'jwt parser' })
    expect(belt.included).toContain('jwt-parser')
    expect(belt.withheld).toEqual([])
  })

  it('respects the cap', () => {
    const belt = buildToolbelt({ locality: 'local', query: 'convert', cap: 3 })
    expect(belt.included.length).toBeLessThanOrEqual(3)
    expect(Object.keys(belt.tools)).toHaveLength(belt.included.length)
  })

  it('caps by default, because the whole registry would not fit a small local model', () => {
    const belt = buildToolbelt({ locality: 'local', query: '' })
    expect(belt.included).toHaveLength(DEFAULT_TOOL_CAP)
  })

  it('ranks the obviously relevant tool into the belt', () => {
    expect(buildToolbelt({ locality: 'local', query: 'decode this JWT' }).included).toContain('jwt-parser')
    expect(buildToolbelt({ locality: 'local', query: 'cidr subnet' }).included).toContain('cidr-calculator')
  })

  it('exposes tools the SDK can actually call', () => {
    const belt = buildToolbelt({ locality: 'local', query: 'base64' })
    for (const [name, tool] of Object.entries(belt.tools)) {
      expect(toolIdFor(name)).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
      expect(tool.description).toBeTruthy()
    }
  })

  it('runs the real tool, so the model never has to compute the answer itself', async () => {
    const belt = buildToolbelt({ locality: 'local', query: 'base64 encode' })
    const encoder = belt.tools[toolNameFor('base64')]
    expect(encoder).toBeDefined()

    const output = await encoder?.execute?.(
      { text: 'devdesk', mode: 'encode' },
      { toolCallId: 't1', messages: [], context: undefined },
    )
    expect(output).toBe(Buffer.from('devdesk').toString('base64'))
  })

  it('keeps pinned tools even when the query points elsewhere', () => {
    const belt = buildToolbelt({ locality: 'local', query: 'cidr subnet', pinned: ['jwt-parser'], cap: 4 })
    expect(belt.included[0]).toBe('jwt-parser')
    expect(belt.included).toHaveLength(4)
    expect(belt.included).toContain('cidr-calculator')
  })

  it('does not let a pinned tool smuggle itself past the privacy gate', () => {
    const belt = buildToolbelt({ locality: 'remote', query: 'anything', pinned: ['jwt-parser'] })
    expect(belt.included).not.toContain('jwt-parser')
  })
})

describe('selectRelevant', () => {
  it('ranks a whole sentence, not just a palette-style prefix', () => {
    // The command palette's own search matches the query as one subsequence, spaces
    // included, so a sentence matches nothing. These are the questions users type.
    const belt = (query: string) => buildToolbelt({ locality: 'local', query }).included
    expect(belt('decode this JWT and tell me when it expires')).toContain('jwt-parser')
    expect(belt('base64 encode this string for me')).toContain('base64')
    expect(belt('how many hosts fit in a /22 cidr block?')).toContain('cidr-calculator')
    expect(belt('what does this cron expression mean')).toContain('cron-generator')
    expect(belt('convert 1700000000 to a readable date')).toContain('timestamp')
  })

  it('survives a typo, via the fuzzy match underneath', () => {
    expect(buildToolbelt({ locality: 'local', query: 'base46' }).included).toContain('base64')
  })

  it('fills the belt to the cap even when the question ranks almost nothing', () => {
    // A weak query used to yield a two- or three-tool belt, wasting the budget on a
    // question the heuristic simply could not classify.
    for (const query of ['zzzz qqqq', 'go', 'help me out here', '']) {
      expect(buildToolbelt({ locality: 'local', query }).included, query).toHaveLength(DEFAULT_TOOL_CAP)
    }
  })

  it('still puts the ranked tools first when it tops the belt up', () => {
    const belt = buildToolbelt({ locality: 'local', query: 'jwt' })
    expect(belt.included[0]).toBe('jwt-parser')
  })

  it('never returns duplicates when a pinned tool also ranks', () => {
    const allowed = runnableTools()
    const picked = selectRelevant(allowed, 'jwt', ['jwt-parser'], 10)
    expect(new Set(picked.map((m) => m.id)).size).toBe(picked.length)
  })

  it('ignores a pinned id that is not in the allowed set', () => {
    const picked = selectRelevant(runnableTools(), '', ['not-a-real-tool'], 3)
    expect(picked.map((m) => m.id)).not.toContain('not-a-real-tool')
    expect(picked).toHaveLength(3)
  })

  it('can exceed the cap only for pinned tools, which the model has already seen', () => {
    const pinned = runnableTools().slice(0, 5).map((m) => m.id)
    const picked = selectRelevant(runnableTools(), 'jwt', pinned, 2)
    expect(picked.length).toBeGreaterThanOrEqual(5)
  })
})

describe('describeTool', () => {
  it('folds UI field labels and options into the description', () => {
    const meta = runnableTools().find((m) => m.id === 'base64')
    expect(meta).toBeDefined()

    const described = describeTool(meta!, {
      fields: [
        { kind: 'select', name: 'mode', label: 'Direction', options: ['encode', 'decode'] },
      ],
    })

    expect(described).toContain(meta!.description)
    expect(described).toContain('mode — Direction')
    expect(described).toContain('one of: encode, decode')
  })

  it('works with no UI hint at all — the bespoke-UI tools have none', () => {
    const meta = runnableTools().find((m) => m.id === 'regex-tester')
    expect(meta).toBeDefined()
    expect(describeTool(meta!)).toContain(meta!.description)
  })
})

describe('tool name mapping', () => {
  it('round-trips every runnable tool id', () => {
    for (const meta of runnableTools()) {
      expect(toolIdFor(toolNameFor(meta.id))).toBe(meta.id)
    }
  })

  it('produces names providers accept', () => {
    for (const meta of runnableTools()) {
      expect(toolNameFor(meta.id)).toMatch(/^[A-Za-z0-9_]+$/)
    }
  })

  it('returns undefined for a name the model invented', () => {
    expect(toolIdFor('definitely_not_a_tool')).toBeUndefined()
  })
})
