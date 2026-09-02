import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import MermaidBlock from './MermaidBlock.vue'

// The node view only needs the slice of Tiptap's props it actually reads.
function mountBlock(caret: number, isFocused = true) {
  const selection = { from: caret, to: caret }
  const listeners: (() => void)[] = []
  const editor = {
    state: { selection },
    isFocused,
    on: (event: string, fn: () => void) => { if (event === 'selectionUpdate') listeners.push(fn) },
    off: () => {},
  }
  const wrapper = mount(MermaidBlock, {
    props: {
      editor,
      node: { attrs: { language: 'mermaid' }, textContent: 'graph TD\nA-->B', nodeSize: 12 },
      getPos: () => 10,
      decorations: [], selected: false, extension: {}, updateAttributes: () => {}, deleteNode: () => {},
      view: {}, innerDecorations: [], HTMLAttributes: {},
    } as never,
    // Provided by VueNodeViewRenderer in the real editor.
    global: { provide: { decorationClasses: ref(''), onDragStart: () => {} } },
    attachTo: document.body,
  })
  const moveCaret = async (to: number) => {
    selection.from = selection.to = to
    listeners.forEach((fn) => fn())
    await nextTick()
  }
  return { wrapper, moveCaret }
}

describe('MermaidBlock', () => {
  it('renders the diagram while the caret is elsewhere', () => {
    const { wrapper } = mountBlock(0)
    expect(wrapper.find('.mermaid').exists()).toBe(true)
  })

  it('renders the diagram in an unfocused editor, wherever its caret sits', () => {
    const { wrapper } = mountBlock(11, false)
    expect(wrapper.find('.mermaid').exists()).toBe(true)
  })

  it('shows the source while the caret is inside, so a diagram can be written', async () => {
    // Rendering over the block as soon as it exists left nowhere to type.
    const { wrapper } = mountBlock(11)
    expect(wrapper.find('.mermaid').exists()).toBe(false)
    expect(wrapper.find('pre').isVisible()).toBe(true)

    const { wrapper: other, moveCaret } = mountBlock(0)
    expect(other.find('.mermaid').exists()).toBe(true)
    await moveCaret(15)
    expect(other.find('.mermaid').exists()).toBe(false)
  })

  it('toggles the source by hand too', async () => {
    const { wrapper } = mountBlock(0)
    await wrapper.find('[aria-label="Edit diagram source"]').trigger('click')
    expect(wrapper.find('.mermaid').exists()).toBe(false)
    await wrapper.find('[aria-label="Show diagram"]').trigger('click')
    expect(wrapper.find('.mermaid').exists()).toBe(true)
  })
})
