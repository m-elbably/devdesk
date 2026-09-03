import { beforeAll, describe, expect, it, vi } from 'vitest'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { registerBuiltinTools } from '@devdesk/tools'
import { DEFAULT_MAX_STEPS, lastUserText, runTurn, SYSTEM_PROMPT } from './agent'
import { toolNameFor } from './toolbelt'

beforeAll(() => {
  registerBuiltinTools()
})

/** V4 nests its token counts; a flat shape silently fails to parse as a finish part. */
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0, prediction: undefined },
  totalTokens: 2,
}

/** V4 reports a finish reason as an object, not a bare string. */
const finishWith = (unified: 'stop' | 'tool-calls'): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw: unified },
  usage: USAGE,
})

const text = (body: string): LanguageModelV4StreamPart[] => [
  { type: 'text-start', id: '0' },
  { type: 'text-delta', id: '0', delta: body },
  { type: 'text-end', id: '0' },
]

const callTool = (toolName: string, input: unknown, id = 'call-1'): LanguageModelV4StreamPart[] => [
  { type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) },
]

/** A model that plays a fixed script, one step per entry, recording what it was sent. */
function scriptedModel(steps: LanguageModelV4StreamPart[][]) {
  const calls: LanguageModelV4CallOptions[] = []
  let step = 0

  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options)
      const parts = steps[Math.min(step, steps.length - 1)] ?? text('done')
      step += 1
      return { stream: convertArrayToReadableStream([{ type: 'stream-start', warnings: [] }, ...parts]) }
    },
  })

  return { model, calls, stepCount: () => step }
}

const user = (content: string) => ({ role: 'user' as const, content })

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const part of stream) out.push(part)
  return out
}

describe('lastUserText', () => {
  it('reads the newest user message', () => {
    expect(
      lastUserText([user('first'), { role: 'assistant', content: 'reply' }, user('second')]),
    ).toBe('second')
  })

  it('flattens a multi-part message down to its text', () => {
    expect(
      lastUserText([
        { role: 'user', content: [{ type: 'text', text: 'decode' }, { type: 'text', text: 'this jwt' }] },
      ]),
    ).toBe('decode this jwt')
  })

  it('is empty when there is no user message to rank against', () => {
    expect(lastUserText([])).toBe('')
    expect(lastUserText([{ role: 'assistant', content: 'hi' }])).toBe('')
  })
})

describe('runTurn', () => {
  it('streams a plain answer when no tool is needed', async () => {
    const { model } = scriptedModel([[...text('Hello.'), finishWith('stop')]])
    const turn = runTurn({ model, locality: 'local', messages: [user('hi')] })

    expect(await turn.stream.text).toBe('Hello.')
  })

  it('actually runs the tool, rather than letting the model answer from memory', async () => {
    const { model } = scriptedModel([
      [...callTool(toolNameFor('base64'), { text: 'devdesk', mode: 'encode' }), finishWith('tool-calls')],
      [...text('Here it is.'), finishWith('stop')],
    ])

    const turn = runTurn({ model, locality: 'local', messages: [user('base64 encode devdesk')] })
    const steps = await turn.stream.steps

    const results = steps.flatMap((step) => step.toolResults)
    expect(results).toHaveLength(1)
    // The real tool's real output — not something the model produced.
    expect(results[0]?.output).toBe(Buffer.from('devdesk').toString('base64'))
  })

  it('sends the system prompt and only the ranked tools', async () => {
    const { model, calls } = scriptedModel([[...text('ok'), finishWith('stop')]])
    const turn = runTurn({ model, locality: 'local', messages: [user('decode a jwt')], toolCap: 5 })
    await turn.stream.text

    const first = calls[0]
    expect(JSON.stringify(first?.prompt)).toContain(SYSTEM_PROMPT.slice(0, 40))
    expect(first?.tools).toHaveLength(5)
    expect(first?.tools?.map((t) => t.name)).toContain(toolNameFor('jwt-parser'))
  })

  it('withholds NEVER_PERSIST tools from a remote model, in the payload itself', async () => {
    const { model, calls } = scriptedModel([[...text('ok'), finishWith('stop')]])
    const turn = runTurn({ model, locality: 'remote', messages: [user('decode a jwt')], toolCap: 25 })
    await turn.stream.text

    const names = calls[0]?.tools?.map((t) => t.name) ?? []
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain(toolNameFor('jwt-parser'))
    expect(turn.belt.withheld.map((w) => w.id)).toContain('jwt-parser')
  })

  it('recovers from a tool name the model invented', async () => {
    const { model } = scriptedModel([
      [...callTool('summon_a_unicorn', { wish: 'please' }), finishWith('tool-calls')],
      [...text('Sorry, I cannot do that.'), finishWith('stop')],
    ])

    const turn = runTurn({ model, locality: 'local', messages: [user('do something impossible')] })
    const parts = await collect(turn.stream.fullStream)

    // A recoverable turn: the bad call becomes an error part the model is told about,
    // and the turn still produces an answer instead of throwing.
    expect(parts.map((p) => p.type)).toContain('tool-error')
    expect(await turn.stream.text).toBe('Sorry, I cannot do that.')
  })

  it('recovers from arguments that do not fit the schema', async () => {
    const { model } = scriptedModel([
      // `mode` must be encode|decode; a number is not a string either.
      [...callTool(toolNameFor('base64'), { text: 42, mode: 'transmogrify' }), finishWith('tool-calls')],
      [...text('Let me try that again.'), finishWith('stop')],
    ])

    const turn = runTurn({ model, locality: 'local', messages: [user('base64 encode something')] })
    const parts = await collect(turn.stream.fullStream)

    const failure = parts.find((p) => p.type === 'tool-error')
    expect(failure).toBeDefined()
    expect(await turn.stream.text).toBe('Let me try that again.')
  })

  it('does not report a recoverable tool failure as a stream error', async () => {
    // These are routine with small models; treating one as a stream error would put
    // a red banner on a turn that recovered perfectly well.
    const onStepError = vi.fn()
    const { model } = scriptedModel([
      [...callTool('summon_a_unicorn', {}), finishWith('tool-calls')],
      [...text('ok'), finishWith('stop')],
    ])

    await runTurn({ model, locality: 'local', messages: [user('go')], onStepError }).stream.text
    expect(onStepError).not.toHaveBeenCalled()
  })

  it('tells the model what went wrong, so it can correct itself', async () => {
    const { model, calls } = scriptedModel([
      [...callTool('summon_a_unicorn', {}), finishWith('tool-calls')],
      [...text('ok'), finishWith('stop')],
    ])
    await runTurn({ model, locality: 'local', messages: [user('go')] }).stream.text

    // The second request carries the failure back as a tool result rather than
    // dropping it, which is the whole reason a bad call is recoverable.
    expect(JSON.stringify(calls[1]?.prompt)).toMatch(/summon_a_unicorn/)
  })

  it('stops at the step cap when the model loops on a tool forever', async () => {
    const { model, stepCount } = scriptedModel([
      // One script entry, reused for every step: a model stuck calling the same tool.
      [...callTool(toolNameFor('base64'), { text: 'x', mode: 'encode' }), finishWith('tool-calls')],
    ])

    const turn = runTurn({ model, locality: 'local', messages: [user('loop')], maxSteps: 3 })
    const steps = await turn.stream.steps

    expect(steps).toHaveLength(3)
    expect(stepCount()).toBe(3)
  })

  it('defaults to a step cap rather than running unbounded', async () => {
    const { model, stepCount } = scriptedModel([
      [...callTool(toolNameFor('base64'), { text: 'x', mode: 'encode' }), finishWith('tool-calls')],
    ])
    await runTurn({ model, locality: 'local', messages: [user('loop')] }).stream.steps

    expect(stepCount()).toBe(DEFAULT_MAX_STEPS)
  })

  it('keeps a tool in the belt once it has been used, so earlier turns stay readable', async () => {
    const { model, calls } = scriptedModel([[...text('ok'), finishWith('stop')]])
    const turn = runTurn({
      model,
      locality: 'local',
      messages: [user('now something completely unrelated')],
      pinned: ['jwt-parser'],
      toolCap: 3,
    })
    await turn.stream.text

    expect(calls[0]?.tools?.map((t) => t.name)).toContain(toolNameFor('jwt-parser'))
    expect(turn.belt.included[0]).toBe('jwt-parser')
  })

  it('ranks on the newest message, not the whole conversation', async () => {
    const { model, calls } = scriptedModel([[...text('ok'), finishWith('stop')]])
    await runTurn({
      model,
      locality: 'local',
      messages: [user('tell me about cidr blocks'), { role: 'assistant', content: 'sure' }, user('now decode a jwt')],
      toolCap: 4,
    }).stream.text

    expect(calls[0]?.tools?.map((t) => t.name)).toContain(toolNameFor('jwt-parser'))
  })
})
