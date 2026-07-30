<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { createJSONEditor, Mode, type JsonEditor, type Content, type TextContent } from 'vanilla-jsoneditor'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** Full editor (tree + text, menu/status bars) vs. compact text-only pane. */
    light?: boolean
    /** Disable editing. Used for read-only output panes. */
    readOnly?: boolean
    placeholder?: string
    /** Drop the bordered card chrome and fill the parent height (use for output panes). */
    bare?: boolean
  }>(),
  { light: false, readOnly: false, placeholder: '', bare: false },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const container = ref<HTMLDivElement>()
let editor: JsonEditor | null = null

// The editor ships its own base styles; only the dark *override* CSS is imported.
// It scopes under `.jse-theme-dark`, so we mirror the app's dark mode (vueuse's
// useDark toggles a `dark` class on <html>, see ThemeSwitcher.vue) onto the
// wrapper class and react to live toggle so the editor follows the light/dark
// switch instead of being pinned to one look.
const isDark = ref(document.documentElement.classList.contains('dark'))
function syncTheme() {
  isDark.value = document.documentElement.classList.contains('dark')
}
const themeObserver = new MutationObserver(syncTheme)

// Copy the current editor contents to the clipboard (read-only safe).
async function copyContents() {
  if (!editor) return
  const current = editor.get()
  await navigator.clipboard.writeText((current as TextContent).text ?? '')
}

// Paste clipboard contents into the editor, replacing its contents.
async function pasteContents() {
  if (!editor || props.readOnly) return
  const text = await navigator.clipboard.readText()
  if (text) void editor.updateProps({ content: { text } })
}

// Clear the editor contents.
function clearContents() {
  if (!editor || props.readOnly) return
  void editor.updateProps({ content: { text: '' } })
}

// Exposed so a host page (e.g. the standalone JSON Editor tool's header) can
// wire its own top-right Copy/Paste/Clear actions to the live editor contents.
defineExpose({ copy: copyContents, paste: pasteContents, clear: clearContents })

// Light mode is the shared component for the other JSON tools: text-only, no
// chrome, compact. The full mode is the standalone JSON Editor tool. The theme
// follows the app's theme (see isDark), so we never pin to dark here.
function buildEditor(): JsonEditor {
  const content: Content = {
    text: props.modelValue || props.placeholder,
  }
  return createJSONEditor({
    target: container.value!,
    props: {
      content,
      mode: Mode.text,
      readOnly: props.readOnly,
      mainMenuBar: !props.light,
      navigationBar: !props.light,
      statusBar: !props.light,
      // Suppress the "Do you want to format the JSON?" prompt that vanilla-jsoneditor
      // surfaces when content is loaded/changed; outputs are already formatted.
      askToFormat: false,
      onChange: (updated: Content) => emit('update:modelValue', (updated as TextContent).text ?? ''),
    },
  })
}

onMounted(() => {
  editor = buildEditor()
  // Track the app theme so the editor restyles on light/dark toggle.
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  themeObserver.disconnect()
  editor?.destroy()
  editor = null
})

// External changes (paste, clear, switching tools, live re-run) sync in, but
// skip when the editor already holds this text so we don't fight the user's typing.
watch(
  () => props.modelValue,
  (text) => {
    if (!editor) return
    const current = editor.get()
    if (text !== ((current as TextContent).text ?? '')) {
      void editor.updateProps({ content: { text } })
    }
  },
)
watch(
  () => props.readOnly,
  (ro) => editor?.updateProps({ readOnly: ro }),
)
</script>

<template>
  <div
    ref="container"
    class="rounded-lg border border-default overflow-hidden flex-1 min-h-0"
    :class="[isDark ? 'jse-theme-dark' : '', light ? 'jse-light text-sm' : 'h-full']"
    :style="light ? 'min-height: 16rem; height: 32rem; max-height: 32rem' : 'height: 100%'"
  />
</template>

<style>
/* Light mode is a bare editor pane: tighten padding/font and drop the menu/bar
   height so it reads as a compact input like the old textarea, not a full IDE. */
.jse-light .jse-main {
  padding: 0.25rem 0.5rem;
}
.jse-light .cm-editor {
  font-size: 0.875rem;
}
.jse-light .jse-status-bar,
.jse-light .jse-navigation-bar,
.jse-light .jse-menu {
  display: none;
}

/* In dark mode the toolbar (`.jse-menu`) is painted with `--jse-theme-color`,
   which both themes inherit from the same blue accent. Darken it to sit on the
   editor's dark surface instead of glowing the light-mode accent. */
.jse-theme-dark {
  --jse-theme-color: #2a2a2a;
  --jse-theme-color-highlight: #3a3a3a;
}
</style>
