import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@devdesk/database'
import {
  activeLocality,
  activeProvider,
  isConfigured,
  loadProviders,
  prepareOutbound,
  providers,
  removeProvider,
  saveProvider,
  setActiveProvider,
  setToolCap,
  toolCap,
  uiHints,
} from './ai'
import type { ProviderConfig } from '@devdesk/ai'

const local = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'local-1',
  kind: 'lmstudio',
  label: 'LM Studio',
  baseUrl: 'http://localhost:1234/v1',
  apiKey: '',
  model: 'qwen2.5-coder',
  transport: 'auto',
  redact: false,
  ...over,
})

const cloud = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'cloud-1',
  kind: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  transport: 'auto',
  redact: true,
  ...over,
})

beforeEach(async () => {
  await db.aiProviders.clear()
  localStorage.clear()
  providers.value = []
  setActiveProvider('')
  await loadProviders()
})

describe('provider storage', () => {
  it('starts unconfigured', () => {
    expect(isConfigured.value).toBe(false)
    expect(activeProvider.value).toBeUndefined()
  })

  it('saves and reloads a provider, and activates the first one added', async () => {
    await saveProvider(local())

    expect(isConfigured.value).toBe(true)
    expect(activeProvider.value?.label).toBe('LM Studio')
    expect(activeProvider.value?.apiKey).toBe('')
  })

  it('round-trips an API key without mangling it', async () => {
    await saveProvider(cloud())
    await loadProviders()
    expect(activeProvider.value?.apiKey).toBe('sk-test')
  })

  it('falls back to a remaining provider when the active one is removed', async () => {
    await saveProvider(local())
    await saveProvider(cloud())
    setActiveProvider('cloud-1')

    await removeProvider('cloud-1')

    expect(activeProvider.value?.id).toBe('local-1')
  })

  it('goes back to unconfigured when the last provider is removed', async () => {
    await saveProvider(local())
    await removeProvider('local-1')

    expect(isConfigured.value).toBe(false)
    expect(activeProvider.value).toBeUndefined()
  })
})

describe('activeLocality', () => {
  it('follows the active provider', async () => {
    await saveProvider(local())
    expect(activeLocality.value).toBe('local')

    await saveProvider(cloud())
    setActiveProvider('cloud-1')
    expect(activeLocality.value).toBe('remote')
  })

  it('is remote when nothing is configured', () => {
    // Fails closed: no provider means no assumption that one is safe.
    expect(activeLocality.value).toBe('remote')
  })

  it('is derived from the URL, not from what the row claims', async () => {
    // A row is just data — an edited backup or a hand-written config could say
    // anything. The URL is the only thing that decides where the traffic goes.
    await saveProvider(cloud({ id: 'liar', label: 'Definitely Local', kind: 'custom' }))
    setActiveProvider('liar')
    expect(activeLocality.value).toBe('remote')
  })
})

describe('prepareOutbound', () => {
  const secret = 'here is my api_key: sk-live-9999 and Authorization: Bearer tok-1234'

  it('redacts for a provider that asks for it', async () => {
    await saveProvider(cloud({ redact: true }))
    const out = prepareOutbound(secret)

    expect(out).not.toContain('sk-live-9999')
    expect(out).not.toContain('tok-1234')
    expect(out).toContain('[REDACTED]')
  })

  it('leaves text alone for a local provider with redaction off', async () => {
    await saveProvider(local({ redact: false }))
    expect(prepareOutbound(secret)).toBe(secret)
  })

  it('is a no-op with no provider, since nothing can be sent anyway', () => {
    expect(prepareOutbound(secret)).toBe(secret)
  })
})

describe('toolCap', () => {
  it('persists across a reload', () => {
    setToolCap(4)
    expect(toolCap.value).toBe(4)
    expect(localStorage.getItem('devdesk.ai.toolCap')).toBe('4')
  })

  it('clamps to a workable range rather than accepting nonsense', () => {
    setToolCap(0)
    expect(toolCap.value).toBe(1)
    setToolCap(9999)
    expect(toolCap.value).toBe(60)
    setToolCap(7.6)
    expect(toolCap.value).toBe(8)
  })
})

describe('uiHints', () => {
  it('carries field labels and select options through to the model', () => {
    const hint = uiHints['base64']
    expect(hint).toBeDefined()

    const mode = hint?.fields.find((f) => f.name === 'mode')
    expect(mode?.label).toBeTruthy()
    expect(mode?.options).toEqual(expect.arrayContaining(['encode', 'decode']))
  })

  it('covers most of the toolbox', () => {
    expect(Object.keys(uiHints).length).toBeGreaterThan(60)
  })
})
