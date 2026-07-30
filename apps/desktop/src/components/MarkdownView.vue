<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { renderMarkdown, hasMermaid } from '@/lib/markdown'
import { desktop } from '@/services/desktop'

const props = defineProps<{ source: string; open?: boolean }>()
// v-html is safe here: renderMarkdown sanitizes via DOMPurify.
const html = computed(() => renderMarkdown(props.source))

// Info links should open in the system browser, not inside the app's webview.
function onLinkClick(e: MouseEvent) {
  const a = (e.target as HTMLElement)?.closest('a')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  // Only intercept real http(s) links; in-app/anchor links keep default behavior.
  if (!/^https?:\/\//i.test(href)) return
  e.preventDefault()
  void desktop.openExternal(href)
}

const root = ref<HTMLDivElement>()

// --- Mermaid ---------------------------------------------------------------
// Mermaid is heavy (~2 MB) so it's lazy-loaded only when a markdown source
// actually contains ```mermaid blocks. The module is cached at the instance
// level so repeated dialogs reuse the same import.
type MermaidAPI = typeof import('mermaid')['default']
let mermaidMod: MermaidAPI | null = null
let loadingMermaid: Promise<MermaidAPI> | null = null

async function ensureMermaid(): Promise<MermaidAPI> {
  if (mermaidMod) return mermaidMod
  if (!loadingMermaid) loadingMermaid = import('mermaid').then((m) => m.default)
  mermaidMod = await loadingMermaid
  return mermaidMod
}

const isDark = ref(document.documentElement.classList.contains('dark'))
function syncTheme() {
  isDark.value = document.documentElement.classList.contains('dark')
}
const themeObserver = new MutationObserver(syncTheme)

// Raw mermaid source per element, captured at first render. We can't rely on a
// DOM attribute (DOMPurify may strip/hostile-clean it, and after the first run the
// node's textContent is the rendered SVG) — so keep the source in a Map and restore
// from it when re-rendering on theme/visibility change.
const graphSources = new WeakMap<HTMLElement, string>()

// (Re)render every .mermaid element inside the component root. Mermaid replaces
// the raw-graph div with an <svg>. Elements already processed get [data-processed]
// so we don't double-render; on theme/visibility change we reset them and re-run.
async function renderDiagrams(force = false) {
  const el = root.value
  if (!el) return
  const nodes = Array.from(el.querySelectorAll<HTMLDivElement>('.mermaid'))
  if (nodes.length === 0) return

  // Wait for the monospace font to finish loading. Mermaid measures node widths
  // from the (fallback) font at render time — if the real font loads *after*,
  // the boxes are too narrow and the actual text overflows/clips. Awaiting the
  // font load makes the measurement use the final metrics.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      // ignore — fall back to whatever is available
    }
  }

  const mermaid = await ensureMermaid()
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark.value ? 'dark' : 'default',
    // `loose` + htmlLabels:true keeps HTML labels so mermaid measures node widths
    // from the rendered text rather than a synthetic <text> node. Our sources are
    // trusted static markdown (sanitized by DOMPurify upstream), so loose is safe.
    securityLevel: 'loose',
    htmlLabels: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  })

  if (force) {
    for (const n of nodes) {
      n.removeAttribute('data-processed')
      // Restore the original graph source so mermaid can re-render. textContent
      // avoids HTML parsing — mermaid reads textContent when it runs.
      n.textContent = graphSources.get(n) ?? n.textContent ?? ''
    }
  }

  const pending = nodes.filter((n) => !n.hasAttribute('data-processed'))
  if (pending.length === 0) return
  // Snapshot the raw graph source from each pending node's textContent *before*
  // mermaid.run transforms it into SVG markup. We restore from this snapshot on
  // later force re-renders rather than from the (now-SVG) textContent.
  for (const n of pending) graphSources.set(n, n.textContent ?? '')
  try {
    await mermaid.run({ nodes: pending })
    for (const n of pending) n.setAttribute('data-processed', 'true')
  } catch {
    // Mermaid throws on syntax errors; leave the raw text visible so the
    // user can spot the problem in the diagram source.
  }
}

watch(html, async () => {
  await nextTick()
  if (hasMermaid(props.source)) await renderDiagrams()
})

// The host (modal) is display:none until opened, so the initial render has no
// layout to measure node widths against and clips label text. Re-render once the
// container becomes visible (and after the font settles) so measurements are correct.
watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      if (hasMermaid(props.source)) await renderDiagrams(true)
    }
  },
)

// Re-render diagrams when the theme flips (dark ↔ light).
watch(isDark, async () => {
  await nextTick()
  if (hasMermaid(props.source)) await renderDiagrams(true)
})

onMounted(() => {
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  if (hasMermaid(props.source)) void renderDiagrams()
})

onBeforeUnmount(() => themeObserver.disconnect())
</script>

<template>
  <div ref="root" class="prose prose-sm max-w-none" @click="onLinkClick" v-html="html" />
</template>

<!-- ponytail: @tailwindcss/typography isn't installed, so `prose` was inert and
     markdown rendered as unstyled plain text. Rather than pull the plugin (which
     then needs prose-invert wiring for the dark theme), style the rendered tags
     directly with Nuxt UI's CSS vars so both themes just work. :deep() is required
     because the HTML is injected via v-html. -->
<style scoped>
.prose {
  color: var(--ui-text);
  line-height: 1.6;
}
.prose :deep(> :first-child) {
  margin-top: 0;
}
.prose :deep(> :last-child) {
  margin-bottom: 0;
}
.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4) {
  font-weight: 600;
  line-height: 1.25;
  margin: 1.4em 0 0.6em;
}
.prose :deep(h1) {
  font-size: 1.6em;
}
.prose :deep(h2) {
  font-size: 1.35em;
}
.prose :deep(h3) {
  font-size: 1.15em;
}
.prose :deep(h4) {
  font-size: 1em;
}
.prose :deep(p),
.prose :deep(ul),
.prose :deep(ol),
.prose :deep(blockquote),
.prose :deep(pre),
.prose :deep(table) {
  margin: 0.75em 0;
}
.prose :deep(ul),
.prose :deep(ol) {
  padding-left: 1.5em;
}
.prose :deep(ul) {
  list-style: disc;
}
.prose :deep(ol) {
  list-style: decimal;
}
.prose :deep(li) {
  margin: 0.25em 0;
}
.prose :deep(li > ul),
.prose :deep(li > ol) {
  margin: 0.25em 0;
}
.prose :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
}
.prose :deep(strong) {
  font-weight: 600;
}
.prose :deep(blockquote) {
  border-left: 3px solid var(--ui-bg-elevated);
  padding-left: 1em;
  color: color-mix(in oklab, var(--ui-text) 70%, transparent);
}
.prose :deep(hr) {
  border: 0;
  border-top: 1px solid var(--ui-bg-elevated);
  margin: 1.5em 0;
}
.prose :deep(code) {
  background: var(--ui-bg-muted);
  padding: 0.15em 0.35em;
  border-radius: 0.3em;
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.prose :deep(pre) {
  background: var(--ui-bg-muted);
  padding: 0.85em 1em;
  border-radius: 0.5em;
  overflow-x: auto;
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
}
.prose :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
.prose :deep(th),
.prose :deep(td) {
  border: 1px solid var(--ui-bg-elevated);
  padding: 0.4em 0.6em;
  text-align: left;
}
.prose :deep(th) {
  background: var(--ui-bg-muted);
  font-weight: 600;
}
.prose :deep(img) {
  max-width: 100%;
  border-radius: 0.5em;
}
/* Mermaid SVGs: neutralize prose's auto-margins / borders on the wrapper divs */
.prose :deep(.mermaid) {
  margin: 1em 0;
  text-align: center;
}
.prose :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: inline-block;
}
/* Mermaid's node-width measurement is a few px narrower than the actual
   htmlLabel content in some fonts; foreignObject clips overflow by default,
   stripping the last character(s) of labels. There's slack in the node rect
   around the label, so letting content overflow the foreignObject is safe. */
.prose :deep(.mermaid foreignObject) {
  overflow: visible;
}
</style>
