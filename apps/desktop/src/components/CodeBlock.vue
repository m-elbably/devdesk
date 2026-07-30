<script setup lang="ts">
import { computed, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'

const props = withDefaults(
  defineProps<{
    code: string
    language?: string
    /** Render an editable textarea instead of a readonly highlighted block. */
    editable?: boolean
    placeholder?: string
    /** Show a line-number gutter (editor look, used for code/json tools). */
    lineNumbers?: boolean
    /** Stretch to the parent's height instead of capping at max-h. */
    fill?: boolean
    /** Soft-wrap long lines instead of scrolling horizontally. Needs `fill`. */
    wrap?: boolean
  }>(),
  { editable: false, lineNumbers: false, fill: false, wrap: false },
)
const emit = defineEmits<{ 'update:code': [string] }>()

// highlight.js escapes the code, so the resulting HTML is safe to v-html.
const html = computed(() => {
  const lang = props.language && hljs.getLanguage(props.language) ? props.language : undefined
  return lang
    ? hljs.highlight(props.code, { language: lang }).value
    : hljs.highlightAuto(props.code).value
})

const lineCount = computed(() => Math.max(1, props.code.split('\n').length))

// ponytail: overlay a highlighted <pre> behind a transparent-text textarea so edit
// mode shows the exact same colors as view mode (react-simple-code-editor trick).
// Only horizontal scroll can desync, so mirror it; vertical grows with :rows.
const overlay = ref<HTMLElement>()
function syncScroll(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (overlay.value) {
    overlay.value.scrollLeft = el.scrollLeft
    overlay.value.scrollTop = el.scrollTop
  }
}
</script>

<template>
  <div
    v-if="lineNumbers"
    class="rounded-lg border border-default overflow-y-auto font-mono text-sm"
    :class="fill ? 'h-full' : 'max-h-[32rem]'"
  >
    <!-- min-h-full track: fills the scroller when content is short and grows past
         it when long, so the outer div scrolls. A stretched flex item would get
         clamped to the scrollport here (Chromium), which killed vertical scroll. -->
    <div class="flex min-h-full">
      <!-- Wrapped lines make the gutter lie (one number per logical line, many
           visual rows), so the numbers only show when lines aren't wrapping. -->
      <div v-if="!wrap" class="select-none text-right pl-3 pr-2 py-3 leading-6 text-default/30 bg-muted/50 shrink-0">
        <div v-for="n in lineCount" :key="n">{{ n }}</div>
      </div>
      <div v-if="editable" class="relative flex flex-1 min-w-0">
        <pre ref="overlay" aria-hidden="true" class="hljs !bg-transparent pointer-events-none absolute inset-0 !p-3 m-0 leading-6 overflow-hidden" :class="wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'"><code v-html="html" /></pre>
        <textarea
          class="relative flex-1 min-w-0 resize-none bg-transparent text-transparent caret-[var(--ui-text)] placeholder:text-default/40 p-3 leading-6 outline-none"
          :class="wrap ? 'whitespace-pre-wrap break-words overflow-y-auto' : 'whitespace-pre overflow-x-auto'"
          style="caret-color: var(--ui-text)"
          :rows="wrap ? undefined : lineCount"
          :value="code"
          :placeholder="placeholder"
          spellcheck="false"
          @input="emit('update:code', ($event.target as HTMLTextAreaElement).value)"
          @scroll="syncScroll"
        />
      </div>
      <pre v-else class="hljs !bg-transparent flex-1 min-w-0 !p-3 m-0 leading-6 whitespace-pre-wrap break-all"><code v-html="html" /></pre>
    </div>
  </div>
  <pre v-else class="hljs rounded-lg p-4 overflow-x-auto text-sm"><code v-html="html" /></pre>
</template>
