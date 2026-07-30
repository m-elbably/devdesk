<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { minimalSetup } from 'codemirror'
import { EditorView, placeholder as placeholderExt } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { Bold, Code2, Heading2, Italic, Link, List, ListOrdered, Quote } from 'lucide-vue-next'

// CodeMirror 6 replaces the plain <textarea> notes/tasks used for markdown: syntax
// highlighting and a real editing surface, built entirely from packages already in
// this app (codemirror is used elsewhere for JSON) instead of pulling in a new dep.
// [before, after, placeholder] passed straight to wrap().
const ACTIONS = [
  { label: 'Heading', icon: Heading2, wrap: ['## ', '', 'Heading'] },
  { label: 'Bold', icon: Bold, wrap: ['**', '**', 'bold'] },
  { label: 'Italic', icon: Italic, wrap: ['_', '_', 'italic'] },
  { label: 'Code', icon: Code2, wrap: ['`', '`', 'code'] },
  { label: 'Link', icon: Link, wrap: ['[', '](https://)', 'link'] },
  { label: 'Quote', icon: Quote, wrap: ['> ', '', 'Quote'] },
  { label: 'Bulleted list', icon: List, wrap: ['- ', '', 'Item'] },
  { label: 'Numbered list', icon: ListOrdered, wrap: ['1. ', '', 'Item'] },
] as const satisfies ReadonlyArray<{ label: string; icon: unknown; wrap: readonly [string, string, string] }>

const props = defineProps<{ modelValue: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const container = ref<HTMLDivElement>()
let view: EditorView | undefined

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ui-text)', fontSize: '0.875rem' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '0.5rem' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  // drawSelection() (in minimalSetup) draws its own cursor rather than using
  // the native caret, defaulting to a hardcoded black border-left that only
  // switches color when the theme is registered with `dark: true` — ours
  // isn't, so override it directly with the theme variable instead.
  '.cm-cursor': { borderLeftColor: 'var(--ui-text)' },
  '.cm-placeholder': { color: 'color-mix(in oklab, var(--ui-text) 40%, transparent)' },
})

onMounted(() => {
  view = new EditorView({
    doc: props.modelValue,
    parent: container.value,
    extensions: [
      minimalSetup,
      markdown(),
      theme,
      EditorView.lineWrapping,
      ...(props.placeholder ? [placeholderExt(props.placeholder)] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
      }),
    ],
  })
})
onBeforeUnmount(() => view?.destroy())

watch(
  () => props.modelValue,
  (text) => {
    if (view && text !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    }
  },
)

// Wraps the current selection (or a fallback word) in markdown syntax, e.g.
// wrap('**', '**', 'bold') on an empty selection inserts **bold** and selects "bold".
function wrap(before: string, after = '', fallback = '') {
  if (!view) return
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || fallback
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  })
  view.focus()
}

defineExpose({ focus: () => view?.focus() })
</script>

<template>
  <div class="flex flex-col rounded-lg border border-default bg-default overflow-hidden flex-1 min-h-0">
    <div class="flex flex-wrap gap-1 border-b border-default p-1 shrink-0">
      <UButton
        v-for="a in ACTIONS"
        :key="a.label"
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        square
        :aria-label="a.label"
        :title="a.label"
        @click="wrap(a.wrap[0], a.wrap[1], a.wrap[2])"
      >
        <component :is="a.icon" class="size-4" />
      </UButton>
    </div>
    <div ref="container" class="flex-1 min-h-0" />
  </div>
</template>
