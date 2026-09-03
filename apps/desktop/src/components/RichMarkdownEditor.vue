<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlock from '@tiptap/extension-code-block'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Mathematics } from '@tiptap/extension-mathematics'
import { BaseModal } from '@devdesk/ui'
import MarkdownEditor from './MarkdownEditor.vue'
import MarkdownView from './MarkdownView.vue'
import MermaidBlock from './MermaidBlock.vue'

// Nuxt UI's <UEditor>/<UEditorToolbar> wrap Tiptap: extensions, markdown
// serialisation, toolbar state and styling all ship with the library.
const model = defineModel<string>({ required: true })
defineProps<{ placeholder?: string }>()

const root = useTemplateRef<{ editor: Editor }>('root')
const source = useTemplateRef<{ focus: () => void }>('source')
const urlOpen = ref(false), urlKind = ref<'link' | 'image'>('link'), url = ref('')

// Rich text is the default; source is the escape hatch for the markdown Tiptap's
// schema can't hold (frontmatter, footnotes, callouts, raw HTML), which it would
// otherwise rewrite on the way back out.
const mode = ref<'rich' | 'source' | 'preview'>('rich')

// Tiptap keeps its own copy of the document while the source editor is open:
// feeding it every keystroke would round-trip half-typed markdown back over
// what the user is typing.
const richValue = ref(model.value)
watch(model, (value) => { if (mode.value !== 'source' && value !== richValue.value) richValue.value = value })
// Switching modes is not touching the document — clicking the switch itself
// trips the listeners below, and the rewrite that follows is still not an edit.
watch(mode, (value) => { if (value !== 'source') richValue.value = model.value; touched.value = false })

// Tiptap rewrites whatever it loads into its own canonical markdown, dropping
// what its schema can't hold (frontmatter, footnotes, callouts). That rewrite is
// not an edit: it stays inside the editor and never reaches the note, so opening
// a note leaves it byte-identical and source mode still shows the real markdown.
// A person always touches the component — a key, a click on the toolbar — before
// editing, and the rewrite lands before any of that.
const touched = ref(false)
function onRichUpdate(value: string) {
  richValue.value = value
  if (touched.value) model.value = value
}

// ponytail: only markdown-native formatting is offered — underline/highlight/
// sub/sup/align serialise to syntax no other markdown reader understands.
// Tables come from StarterKit's siblings rather than StarterKit itself; without
// them a pasted markdown table is dropped from the document and lost on save.
const extensions = [
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlock.extend({ addNodeView: () => VueNodeViewRenderer(MermaidBlock) }),
  // $inline$ and $$block$$ LaTeX, rendered by KaTeX and serialised back as-is.
  Mathematics.configure({ katexOptions: { throwOnError: false } }),
]

// ponytail: Tiptap drops plain-text pastes in verbatim, so a copied markdown
// document landed in the note as literal syntax. Parse it as markdown — unless
// the clipboard carries HTML (Tiptap handles that better) or the caret is in a
// code block, where raw text is the point.
const editorProps = {
  handlePaste: (_view: unknown, event: ClipboardEvent) => {
    const editor = root.value?.editor, text = event.clipboardData?.getData('text/plain')
    if (!editor || !text || event.clipboardData?.types.includes('text/html') || editor.isActive('codeBlock')) return false
    return editor.commands.insertContent(text, { contentType: 'markdown' })
  },
}

function ask(kind: 'link' | 'image') { urlKind.value = kind; url.value = ''; urlOpen.value = true }
// Stock link/image handlers call window.prompt(); these open the app's dialog.
const handlers = {
  link: {
    canExecute: () => true,
    isActive: (editor: Editor) => editor.isActive('link'),
    isDisabled: (editor: Editor) => editor.state.selection.empty && !editor.isActive('link'),
    execute: (editor: Editor) => { if (editor.isActive('link')) return editor.chain().focus().unsetLink(); ask('link'); return editor.chain() },
  },
  image: { canExecute: () => true, isActive: () => false, execute: (editor: Editor) => { ask('image'); return editor.chain() } },
}
function applyUrl() {
  const editor = root.value?.editor, value = url.value.trim()
  if (editor && value) (urlKind.value === 'link' ? editor.chain().focus().setLink({ href: value }) : editor.chain().focus().setImage({ src: value })).run()
  urlOpen.value = false
}
defineExpose({
  focus: () => (mode.value === 'source' ? source.value?.focus() : root.value?.editor?.commands.focus()),
  markdown: () => root.value?.editor?.getMarkdown(),
  /** Call after loading a different note, so its rewrite isn't read as an edit. */
  loaded: () => (touched.value = false),
})

const modes = [
  { value: 'rich', icon: 'i-lucide-type', label: 'Rich text' },
  { value: 'source', icon: 'i-lucide-code-xml', label: 'Markdown source' },
  { value: 'preview', icon: 'i-lucide-eye', label: 'Preview' },
] as const
const modeGroup = computed(() => modes.map((entry) => ({
  icon: entry.icon, 'aria-label': entry.label, tooltip: { text: entry.label },
  active: mode.value === entry.value, onClick: () => (mode.value = entry.value),
})))

// Outside rich mode the formatting controls would act on a document nobody is
// looking at, so only the mode switch stays.
const items = computed(() => mode.value !== 'rich' ? [modeGroup.value] : [
  modeGroup.value,
  [
    { kind: 'undo', icon: 'i-lucide-undo-2', 'aria-label': 'Undo', tooltip: { text: 'Undo' } },
    { kind: 'redo', icon: 'i-lucide-redo-2', 'aria-label': 'Redo', tooltip: { text: 'Redo' } },
  ],
  [
    {
      icon: 'i-lucide-heading', 'aria-label': 'Text style', tooltip: { text: 'Text style' }, trailingIcon: 'i-lucide-chevron-down',
      items: [
        { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-pilcrow' },
        { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
        { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
        { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
      ],
    },
    {
      icon: 'i-lucide-list', 'aria-label': 'Lists', tooltip: { text: 'Lists' }, trailingIcon: 'i-lucide-chevron-down',
      items: [
        { kind: 'bulletList', label: 'Bulleted', icon: 'i-lucide-list' },
        { kind: 'orderedList', label: 'Numbered', icon: 'i-lucide-list-ordered' },
        { kind: 'taskList', label: 'Checklist', icon: 'i-lucide-list-checks' },
      ],
    },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', 'aria-label': 'Quote', tooltip: { text: 'Quote' } },
    { kind: 'codeBlock', icon: 'i-lucide-square-code', 'aria-label': 'Code block', tooltip: { text: 'Code block' } },
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', 'aria-label': 'Bold', tooltip: { text: 'Bold' } },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', 'aria-label': 'Italic', tooltip: { text: 'Italic' } },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', 'aria-label': 'Strikethrough', tooltip: { text: 'Strikethrough' } },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', 'aria-label': 'Inline code', tooltip: { text: 'Inline code' } },
  ],
  [
    { kind: 'link', icon: 'i-lucide-link', 'aria-label': 'Link', tooltip: { text: 'Link' } },
    { kind: 'image', icon: 'i-lucide-image', 'aria-label': 'Image', tooltip: { text: 'Image' } },
    { kind: 'horizontalRule', icon: 'i-lucide-minus', 'aria-label': 'Divider', tooltip: { text: 'Divider' } },
  ],
  [{ kind: 'clearFormatting', icon: 'i-lucide-remove-formatting', 'aria-label': 'Clear formatting', tooltip: { text: 'Clear formatting' } }],
] as never)
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col"
    @keydown.capture="touched = true" @pointerdown.capture="touched = true"
    @paste.capture="touched = true" @drop.capture="touched = true"
  >
    <UEditor
      ref="root"
      :model-value="richValue"
      content-type="markdown"
      :starter-kit="{ codeBlock: false }"
      :placeholder="placeholder"
      :extensions="extensions"
      :handlers="handlers"
      :editor-props="editorProps"
      :mention="false"
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-default bg-default"
      :ui="{ content: mode === 'rich' ? 'min-h-0 flex-1 overflow-y-auto p-3' : 'hidden', base: 'sm:px-0' }"
      @update:model-value="onRichUpdate"
    >
      <template #default="{ editor }">
        <UEditorToolbar :editor="editor" :items="items" class="shrink-0 flex-wrap border-b border-default p-1" />
        <MarkdownEditor v-if="mode === 'source'" ref="source" v-model="model" :placeholder="placeholder" />
        <MarkdownView v-else-if="mode === 'preview'" :source="model" open class="min-h-0 flex-1 overflow-y-auto p-3" />
      </template>
    </UEditor>
  </div>

  <BaseModal :open="urlOpen" :title="urlKind === 'link' ? 'Insert link' : 'Insert image'" @close="urlOpen = false">
    <UInput v-model="url" autofocus class="w-full" :placeholder="urlKind === 'link' ? 'https://example.com' : 'https://example.com/image.png'" @keyup.enter="applyUrl" />
    <div class="flex justify-end gap-2 pt-4">
      <UButton size="sm" color="neutral" variant="ghost" @click="urlOpen = false">Cancel</UButton>
      <UButton size="sm" color="primary" :disabled="!url.trim()" @click="applyUrl">Insert</UButton>
    </div>
  </BaseModal>
</template>

<style scoped>
/* Task list items are plain <li>s carrying a checkbox label. */
:deep([data-type='taskList']) { list-style: none; padding-left: 0; }
:deep([data-type='taskItem']) { display: flex; align-items: flex-start; gap: .5rem; }
:deep([data-type='taskItem'] > div) { flex: 1; min-width: 0; }
:deep([data-type='taskItem'] input) { margin-top: .45rem; }
:deep(table) { border-collapse: collapse; width: 100%; }
:deep(:is(th, td)) { border: 1px solid var(--ui-border-accented); padding: .35rem .5rem; }
:deep(th) { background: var(--ui-bg-muted); font-weight: 600; }
</style>
