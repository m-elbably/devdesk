import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ProviderConfig } from '@devdesk/ai'
import AssistantPanel from './AssistantPanel.vue'
import { assistantOpen } from './state'

// Real refs, not objects with a `value` getter: the template only auto-unwraps a
// genuine ref, and a fake one silently renders the wrong branch — which is exactly
// what these tests are checking.
const mock = vi.hoisted(() => ({
  autodetect: vi.fn(),
  loadProviders: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  // Populated by the '@/services/ai' factory below, which is where `vue` can first
  // be imported — vi.hoisted itself runs before any import.
  state: {} as {
    provider: Ref<ProviderConfig | undefined>
    locality: Ref<'local' | 'remote'>
    messages: Ref<unknown[]>
    streaming: Ref<boolean>
    withheld: Ref<{ id: string; name: string }[]>
    error: Ref<string>
  },
}))

vi.mock('@/services/ai', async () => {
  const { computed, ref } = await import('vue')
  mock.state.provider = ref<ProviderConfig | undefined>(undefined)
  mock.state.locality = ref<'local' | 'remote'>('remote')
  mock.state.messages = ref<unknown[]>([])
  mock.state.streaming = ref(false)
  mock.state.withheld = ref<{ id: string; name: string }[]>([])
  mock.state.error = ref('')

  return {
    activeProvider: mock.state.provider,
    activeLocality: mock.state.locality,
    isConfigured: computed(() => mock.state.provider.value !== undefined),
    usingNativeTransport: ref(false),
    loadProviders: mock.loadProviders,
    autodetectLocalProviders: mock.autodetect,
  }
})

vi.mock('./useAssistant', async () => {
  const { computed, ref } = await import('vue')
  return {
    useAssistant: () => ({
      messages: mock.state.messages,
      streaming: mock.state.streaming,
      error: mock.state.error,
      withheld: mock.state.withheld,
      pinned: ref<string[]>([]),
      canSend: computed(() => true),
      locality: mock.state.locality,
      send: mock.send,
      cancel: mock.cancel,
      reset: mock.reset,
      load: vi.fn(),
    }),
  }
})

vi.mock('./usePageContext', async () => {
  const { ref } = await import('vue')
  return { usePageContext: () => ({ available: ref([{ id: 'ctx1', label: 'JSON Editor input', text: '{"a":1}' }]) }) }
})

const local = (): ProviderConfig => ({
  id: 'p1', kind: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1',
  apiKey: '', model: 'qwen2.5-coder', transport: 'auto', redact: false,
})

const cloud = (): ProviderConfig => ({
  id: 'p2', kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk', model: 'gpt-4o', transport: 'auto', redact: true,
})

const mountPanel = async () => {
  const wrapper = mount(AssistantPanel, { global: { stubs: { MessageList: true, ContextChips: false } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.state.provider.value = undefined
  mock.state.locality.value = 'remote'
  mock.state.messages.value = []
  mock.state.streaming.value = false
  mock.state.withheld.value = []
  mock.state.error.value = ''
  assistantOpen.value = true
})

describe('first run', () => {
  it('probes for a local model when nothing is configured', async () => {
    await mountPanel()
    expect(mock.autodetect).toHaveBeenCalled()
  })

  it('does not probe when a provider already exists', async () => {
    mock.state.provider.value = local()
    await mountPanel()
    expect(mock.autodetect).not.toHaveBeenCalled()
  })

  it('explains both routes when no model is found', async () => {
    const text = (await mountPanel()).text()
    expect(text).toContain('LM Studio')
    expect(text).toContain('Ollama')
    expect(text).toMatch(/Settings/)
  })
})

describe('the provider badge', () => {
  it('says where a local model runs, and names it', async () => {
    mock.state.provider.value = local()
    mock.state.locality.value = 'local'
    expect((await mountPanel()).text()).toContain('Local · qwen2.5-coder')
  })

  it('says plainly when the model is in someone else’s cloud', async () => {
    mock.state.provider.value = cloud()
    mock.state.locality.value = 'remote'
    expect((await mountPanel()).text()).toContain('Cloud · OpenAI')
  })
})

describe('page context', () => {
  it('offers what the page can contribute to a local model', async () => {
    mock.state.provider.value = local()
    mock.state.locality.value = 'local'
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Add from this page')
    expect(wrapper.text()).toContain('JSON Editor input')
  })

  it('refuses it for a cloud model, with the reason visible', async () => {
    mock.state.provider.value = cloud()
    mock.state.locality.value = 'remote'
    const wrapper = await mountPanel()

    // Stated, not silently dropped: a chip that vanishes leaves the user unsure
    // whether the page content was sent.
    expect(wrapper.text()).toContain('a cloud provider only receives what you type')
  })

  it('never attaches page context to a cloud provider even if a chip was ticked', async () => {
    mock.state.provider.value = local()
    mock.state.locality.value = 'local'
    const wrapper = await mountPanel()

    const chip = wrapper.findAll('button').find((b) => b.text().includes('JSON Editor input'))
    await chip?.trigger('click')

    // The user switches to a cloud provider before sending.
    mock.state.locality.value = 'remote'
    await wrapper.find('textarea').setValue('what is this?')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mock.send).toHaveBeenCalledWith('what is this?', [])
  })
})

describe('sending', () => {
  beforeEach(() => {
    mock.state.provider.value = local()
    mock.state.locality.value = 'local'
  })

  it('sends on Enter and clears the box', async () => {
    const wrapper = await mountPanel()
    await wrapper.find('textarea').setValue('hello')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mock.send).toHaveBeenCalledWith('hello', [])
    expect(wrapper.find('textarea').element.value).toBe('')
  })

  it('does not send on Shift+Enter, which is a newline', async () => {
    const wrapper = await mountPanel()
    await wrapper.find('textarea').setValue('line one')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(mock.send).not.toHaveBeenCalled()
  })

  it('attaches only the context the user ticked', async () => {
    const wrapper = await mountPanel()
    const chip = wrapper.findAll('button').find((b) => b.text().includes('JSON Editor input'))
    await chip?.trigger('click')

    await wrapper.find('textarea').setValue('explain')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mock.send).toHaveBeenCalledWith('explain', [
      { id: 'ctx1', label: 'JSON Editor input', text: '{"a":1}' },
    ])
  })

  it('offers a stop button while streaming', async () => {
    mock.state.streaming.value = true
    const wrapper = await mountPanel()

    const stop = wrapper.findAll('button').find((b) => b.attributes('title') === 'Stop')
    expect(stop).toBeDefined()
    await stop?.trigger('click')
    expect(mock.cancel).toHaveBeenCalled()
  })
})

describe('withheld tools', () => {
  it('names what the cloud provider was not given', async () => {
    mock.state.provider.value = cloud()
    mock.state.locality.value = 'remote'
    mock.state.withheld.value = [{ id: 'jwt-parser', name: 'JWT Parser' }, { id: 'password', name: 'Password Generator' }]

    expect((await mountPanel()).text()).toContain('JWT Parser, Password Generator')
  })

  it('says nothing when nothing was withheld', async () => {
    mock.state.provider.value = local()
    mock.state.locality.value = 'local'
    expect((await mountPanel()).text()).not.toContain('Withheld')
  })
})
