import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import RichMarkdownEditor from './RichMarkdownEditor.vue'

// Toolbar tooltips need Nuxt UI's provider, which the real app gets from <UApp>.
function mountEditor(modelValue: string) {
  const value = ref(modelValue)
  const editor = ref<{ markdown: () => string }>()
  const wrapper = mount(
    { components: { UApp, RichMarkdownEditor }, setup: () => ({ value, editor }), template: '<UApp><RichMarkdownEditor ref="editor" v-model="value" /></UApp>' },
    { attachTo: document.body },
  )
  return { wrapper, value, editor }
}

describe('RichMarkdownEditor', () => {
  it('loads Markdown and emits Markdown after an edit', async () => {
    const { wrapper, value } = mountEditor('## Heading\n\n```bash\necho ok\n```')
    await nextTick()
    await flushPromises()

    expect(wrapper.find('h2').text()).toBe('Heading')
    expect(wrapper.find('pre').exists()).toBe(true)

    const editor = wrapper.find('[contenteditable="true"]')
    await editor.trigger('focus')
    await editor.trigger('input')
    expect(value.value).toContain('Heading')
  })

  it('offers markdown-native formatting controls', async () => {
    const { wrapper } = mountEditor('')
    await nextTick()
    await flushPromises()

    for (const label of ['Bold', 'Italic', 'Link', 'Image', 'Lists', 'Undo']) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
  })

  it('keeps markdown tables through the round trip', async () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |'
    const { wrapper, editor } = mountEditor(`Intro\n\n${table}\n`)
    await nextTick()
    await flushPromises()

    // StarterKit has no table node: without the table extensions the rows are
    // dropped from the document and the next save writes them away.
    expect(wrapper.findAll('[contenteditable="true"] td')).toHaveLength(2)
    expect(editor.value?.markdown()).toContain('| 1')
  })

  it('renders a mermaid block as a diagram with a toggle back to its source', async () => {
    const { wrapper } = mountEditor('```mermaid\ngraph TD\nA --> B\n```')
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[contenteditable="true"] .mermaid').exists()).toBe(true)
    await wrapper.find('[aria-label="Edit diagram source"]').trigger('click')
    expect(wrapper.find('[contenteditable="true"] .mermaid').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Show diagram"]').exists()).toBe(true)
  })

  it('renders LaTeX and writes it back as $ syntax', async () => {
    const { wrapper, editor } = mountEditor('Mass $E=mc^2$ energy')
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[contenteditable="true"] .katex').exists()).toBe(true)
    expect(editor.value?.markdown()).toContain('$E=mc^2$')
  })

  it('parses pasted plain text as markdown', async () => {
    const { wrapper, editor } = mountEditor('')
    await nextTick()
    await flushPromises()

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], getData: () => '## Pasted\n\n- one\n- two' } })
    wrapper.find('[contenteditable="true"]').element.dispatchEvent(event)
    await nextTick()

    // Without a markdown-aware paste handler this lands as literal '## Pasted'.
    expect(wrapper.find('[contenteditable="true"] h2').text()).toBe('Pasted')
    expect(wrapper.findAll('[contenteditable="true"] li')).toHaveLength(2)
    expect(editor.value?.markdown()).toContain('## Pasted')
  })

  it('switches between rich text, source and preview from the toolbar', async () => {
    const { wrapper } = mountEditor('# Title')
    await nextTick()
    await flushPromises()

    await wrapper.find('[aria-label="Preview"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.prose h1').text()).toBe('Title')

    await wrapper.find('[aria-label="Markdown source"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.cm-content').text()).toContain('# Title')
    // Tiptap's controls would act on a document nobody is looking at; the
    // source editor brings its own markdown-wrapping toolbar instead.
    expect(wrapper.find('[aria-label="Clear formatting"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Bold"]').exists()).toBe(true)

    await wrapper.find('[aria-label="Rich text"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[contenteditable="true"] h1').text()).toBe('Title')
  })

  it('keeps its own rewrite of loaded content out of the model', async () => {
    const { wrapper, value } = mountEditor('')
    await nextTick()
    await flushPromises()

    // Tiptap's schema has no frontmatter or footnotes, so its rendering of this
    // note is lossy. Loading it must not write that loss back.
    const note = '---\ntitle: Runbook\n---\n\nSteps[^1]\n'
    value.value = note
    await nextTick()
    await flushPromises()
    expect(value.value).toBe(note)

    // Once a person has touched the editor, every update is theirs to keep.
    await wrapper.find('[contenteditable="true"]').trigger('keydown', { key: 'x' })
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], getData: () => '# Typed' } })
    wrapper.find('[contenteditable="true"]').element.dispatchEvent(event)
    await nextTick()

    expect(wrapper.find('[contenteditable="true"] h1').text()).toBe('Typed')
    expect(value.value).toContain('# Typed')
  })

  it('survives a round trip through source mode untouched', async () => {
    const note = '---\ntitle: Runbook\n---\n\nSteps[^1]\n'
    const { wrapper, value } = mountEditor(note)
    await nextTick()
    await flushPromises()

    for (const label of ['Markdown source', 'Rich text', 'Preview', 'Rich text']) {
      await wrapper.find(`[aria-label="${label}"]`).trigger('click')
      await nextTick()
      await flushPromises()
    }
    expect(value.value).toBe(note)
  })

  it('does not round-trip source edits through Tiptap while typing', async () => {
    const { wrapper, value } = mountEditor('Body')
    await nextTick()
    await flushPromises()

    await wrapper.find('[aria-label="Markdown source"]').trigger('click')
    await nextTick()
    // Frontmatter has no place in Tiptap's schema: in rich mode it comes back as
    // a heading, so source mode must keep Tiptap out of the loop entirely.
    value.value = '---\ntitle: Note\n---\n\nBody'
    await nextTick()
    await flushPromises()
    expect(value.value).toBe('---\ntitle: Note\n---\n\nBody')
  })

  it('asks for a link URL in a dialog instead of window.prompt', async () => {
    const { wrapper } = mountEditor('hello')
    await nextTick()
    await flushPromises()

    await wrapper.find('[contenteditable="true"]').trigger('focus')
    await wrapper.find('[aria-label="Image"]').trigger('click')
    await nextTick()

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Insert image')
  })
})
