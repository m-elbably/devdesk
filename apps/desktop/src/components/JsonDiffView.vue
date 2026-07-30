<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { minimalSetup } from 'codemirror'
import { EditorView, lineNumbers } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { MergeView } from '@codemirror/merge'
import { tags } from '@lezer/highlight'

// GitHub-style split diff: aligned gaps for lines only on one side, word-level
// highlight within changed lines. @codemirror/merge does the alignment/diffing;
// we just wire it to the reactive left/right strings.
const props = defineProps<{ left: string; right: string }>()
const emit = defineEmits<{ 'update:left': [string]; 'update:right': [string] }>()

const container = ref<HTMLDivElement>()
let view: MergeView | null = null

// ponytail: always requests @codemirror/merge's dark diff palette for contrast
// against our panel background, regardless of the app's light/dark toggle.
// Reacting to the app's light/dark toggle would mean reconfiguring on every
// switch — add if the light theme's diff colors ever look wrong.
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.875rem', lineHeight: '1.5rem' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'color-mix(in oklab, var(--ui-text) 35%, transparent)', border: 'none' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
)

// minimalSetup falls back to @codemirror/language's defaultHighlightStyle, whose
// colors (e.g. bool "#219", keyword "#708") assume a light background and go
// near-invisible on ours. Override with a palette tuned for dark bg.
const jsonSyntaxHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.bool, color: '#79c0ff', fontWeight: 'bold' },
    { tag: tags.null, color: '#79c0ff' },
    { tag: tags.number, color: '#79c0ff' },
    { tag: tags.string, color: '#a5d6ff' },
    { tag: tags.propertyName, color: '#7ee787' },
  ]),
)

function side(doc: string, onChange: (text: string) => void) {
  return {
    doc,
    extensions: [
      minimalSetup,
      lineNumbers(),
      json(),
      theme,
      jsonSyntaxHighlight,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString())
      }),
    ],
  }
}

onMounted(() => {
  view = new MergeView({
    a: side(props.left, (text) => emit('update:left', text)),
    b: side(props.right, (text) => emit('update:right', text)),
    parent: container.value,
    highlightChanges: true,
    gutter: true,
  })
  syncScroll()
})
onBeforeUnmount(() => {
  removeScrollSync()
  view?.destroy()
})

// Each side renders its own .cm-scroller, so they scroll independently and
// drift out of alignment. Mirror the active pane's scrollTop onto the others.
let syncing = false
function onScroll(e: Event) {
  if (syncing) return
  const source = e.target as HTMLElement
  const scrollers = view?.dom.querySelectorAll<HTMLElement>('.cm-scroller')
  if (!scrollers) return
  syncing = true
  scrollers.forEach((el) => {
    if (el !== source) el.scrollTop = source.scrollTop
  })
  requestAnimationFrame(() => {
    syncing = false
  })
}
function syncScroll() {
  view?.dom.querySelectorAll<HTMLElement>('.cm-scroller').forEach((el) => el.addEventListener('scroll', onScroll))
}
function removeScrollSync() {
  view?.dom.querySelectorAll<HTMLElement>('.cm-scroller').forEach((el) => el.removeEventListener('scroll', onScroll))
}

// External changes (paste, clear, switching tools) sync back in; skip when the
// editor already holds this value so we don't fight the user's own typing.
watch(
  () => props.left,
  (text) => {
    if (view && text !== view.a.state.doc.toString()) {
      view.a.dispatch({ changes: { from: 0, to: view.a.state.doc.length, insert: text } })
    }
  },
)
watch(
  () => props.right,
  (text) => {
    if (view && text !== view.b.state.doc.toString()) {
      view.b.dispatch({ changes: { from: 0, to: view.b.state.doc.length, insert: text } })
    }
  },
)
</script>

<template>
  <div ref="container" class="rounded-lg border border-default overflow-hidden h-full" />
</template>

<style>
/* @codemirror/merge's DOM isn't rendered through Vue templates, so this can't be scoped.
   The library's baseTheme forces `.cm-mergeView .cm-editor .cm-scroller` and
   `.cm-mergeView .cm-editor` to height:auto / overflow-y:visible !important, so each
   side grows with content instead of scrolling. Override with selectors of equal/higher
   specificity so each editor fills the height and scrolls on its own scroller (synced in JS). */
.cm-mergeView {
  height: 100%;
  overflow: hidden;
}
.cm-mergeView .cm-mergeViewEditors {
  height: 100%;
}
.cm-mergeView .cm-mergeViewEditor {
  min-height: 0;
  overflow: hidden;
}
.cm-mergeView .cm-mergeViewEditor .cm-editor {
  height: 100% !important;
}
.cm-mergeView .cm-mergeViewEditor .cm-editor .cm-scroller {
  height: 100% !important;
  overflow-y: auto !important;
}
</style>
