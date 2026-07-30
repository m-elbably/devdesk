<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CopyButton, EmptyState, ErrorState } from '@devdesk/ui'

// Flags the engine supports, with what each one actually changes — a regex
// tester is where people come to *learn* the flags, so they get tooltips.
const FLAGS = [
  { flag: 'g', title: 'Global — find every match, not just the first' },
  { flag: 'i', title: 'Ignore case' },
  { flag: 'm', title: 'Multiline — ^ and $ match at line breaks' },
  { flag: 's', title: 'Dotall — . also matches newlines' },
  { flag: 'u', title: 'Unicode — treat the pattern as Unicode code points' },
  { flag: 'y', title: 'Sticky — match only from lastIndex' },
]

const PRESETS = [
  { label: 'Email', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+' },
  { label: 'URL', pattern: 'https?://[^\\s"\'<>]+' },
  { label: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
  { label: 'ISO date', pattern: '\\d{4}-\\d{2}-\\d{2}' },
  { label: 'Hex colour', pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b' },
  { label: 'Duplicate word', pattern: '\\b(\\w+)\\s+\\1\\b' },
]

const pattern = ref('')
const flags = ref('g')
const text = ref('')

function toggleFlag(flag: string) {
  flags.value = flags.value.includes(flag)
    ? flags.value.replace(flag, '')
    : flags.value + flag
}

interface Match {
  match: string
  index: number
  groups: string[]
  named: [string, string][]
}

// A pathological pattern over a long input can lock the UI, so results are
// capped. ponytail: a cap, not a worker — 2k matches is already past the point
// a human reads a table, and the scan itself stays a single pass.
const MATCH_LIMIT = 2000

const compiled = computed<{ re: RegExp | null; error: string }>(() => {
  if (!pattern.value) return { re: null, error: '' }
  try {
    // Scanning always needs `g`; the toggle only controls what the user's own
    // expression would do, and every other flag is passed through untouched.
    const scanFlags = flags.value.includes('g') ? flags.value : flags.value + 'g'
    return { re: new RegExp(pattern.value, scanFlags), error: '' }
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) }
  }
})

// Scans one past the cap so "there are more" is a fact, not a guess.
const scanned = computed<Match[]>(() => {
  const re = compiled.value.re
  if (!re || !text.value) return []
  const out: Match[] = []
  for (const m of text.value.matchAll(re)) {
    out.push({
      match: m[0],
      index: m.index ?? 0,
      groups: m.slice(1).map((g) => g ?? ''),
      named: Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? '']),
    })
    if (out.length > MATCH_LIMIT) break
  }
  return out
})
const truncated = computed(() => scanned.value.length > MATCH_LIMIT)
const matches = computed(() => (truncated.value ? scanned.value.slice(0, MATCH_LIMIT) : scanned.value))

// Widest capture-group count across matches, so the table gets one column per
// group instead of cramming them all into a single cell.
const groupCount = computed(() => Math.max(0, ...matches.value.map((m) => m.groups.length)))

// The rendered test string, split into plain runs and match runs so each match
// can be its own hoverable element in the highlight layer.
const segments = computed(() => {
  const out: { text: string; match: number }[] = []
  let last = 0
  for (const [i, m] of matches.value.entries()) {
    if (m.index > last) out.push({ text: text.value.slice(last, m.index), match: -1 })
    if (m.match) out.push({ text: m.match, match: i })
    last = m.index + m.match.length
  }
  // Trailing newline keeps a final blank line visible in the backdrop, matching
  // how the textarea renders it.
  out.push({ text: text.value.slice(last) + '\n', match: -1 })
  return out
})

// Selected match links the highlight layer and the table both ways: pick a row
// and the highlight scrolls to it; put the caret in a match and its row lights up.
const active = ref(-1)
const backdrop = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const rows = ref<HTMLElement | null>(null)

function scrollTo(container: HTMLElement | null, selector: string) {
  container?.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function selectMatch(i: number) {
  active.value = i
  const m = matches.value[i]
  if (!m) return
  // Selecting from the table also moves the caret, so the next keystroke edits
  // where the user is looking.
  input.value?.focus()
  input.value?.setSelectionRange(m.index, m.index + m.match.length)
  void nextTick(() => {
    syncScroll()
    scrollTo(backdrop.value, `[data-match="${i}"]`)
  })
}

// Caret moved inside the textarea — light up whichever match contains it.
function syncCaret() {
  const pos = input.value?.selectionStart ?? -1
  const found = matches.value.findIndex((m) => pos >= m.index && pos <= m.index + m.match.length)
  if (found === active.value) return
  active.value = found
  if (found >= 0) void nextTick(() => scrollTo(rows.value, `[data-row="${found}"]`))
}

// The highlight layer sits behind the textarea, so it has to track its scroll.
function syncScroll() {
  if (!backdrop.value || !input.value) return
  backdrop.value.scrollTop = input.value.scrollTop
  backdrop.value.scrollLeft = input.value.scrollLeft
}

// Editing invalidates whatever was selected — indices have moved.
watch([pattern, flags, text], () => (active.value = -1))

const copyText = computed(() =>
  matches.value.map((m) => `${m.index}\t${m.match}${m.groups.length ? '\t' + m.groups.join('\t') : ''}`).join('\n'),
)
const display = (s: string) => (s === '' ? '(empty)' : s)
</script>

<template>
  <div class="flex flex-col h-full min-h-0 gap-4">
    <!-- Pattern: full width at the top, framed like a regex literal -->
    <div class="shrink-0 space-y-2">
      <div
        class="flex items-center gap-1.5 rounded-lg border bg-default px-3 py-2 transition-colors"
        :class="compiled.error ? 'border-error' : 'border-default focus-within:border-primary'"
      >
        <span class="font-mono text-lg text-default/40 select-none">/</span>
        <input
          v-model="pattern"
          class="flex-1 min-w-0 bg-transparent font-mono text-base outline-none placeholder:text-default/30"
          placeholder="Enter a regular expression…"
          spellcheck="false"
          aria-label="Regular expression pattern"
        />
        <span class="font-mono text-lg text-default/40 select-none">/</span>
        <UFieldGroup size="xs">
          <UButton
            v-for="f in FLAGS"
            :key="f.flag"
            type="button"
            color="neutral"
            :variant="flags.includes(f.flag) ? 'solid' : 'outline'"
            :title="f.title"
            :aria-pressed="flags.includes(f.flag)"
            class="font-mono w-7 justify-center"
            @click="toggleFlag(f.flag)"
          >
            {{ f.flag }}
          </UButton>
        </UFieldGroup>
        <UButton
          v-if="pattern"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          title="Clear pattern"
          aria-label="Clear pattern"
          @click="pattern = ''"
        />
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-default/50 mr-0.5">Presets</span>
        <UButton
          v-for="p in PRESETS"
          :key="p.label"
          color="neutral"
          variant="soft"
          size="xs"
          @click="pattern = p.pattern"
        >
          {{ p.label }}
        </UButton>
      </div>

      <ErrorState v-if="compiled.error" :message="compiled.error" />
    </div>

    <!-- Test string with the live highlight layer -->
    <div class="flex flex-col flex-1 min-h-0">
      <div class="flex items-center justify-between h-7 shrink-0">
        <span class="text-sm font-medium text-default/60">Test string</span>
        <div class="flex items-center gap-2">
          <UBadge v-if="pattern && !compiled.error" :color="matches.length ? 'success' : 'neutral'" variant="soft" size="sm">
            {{ matches.length }} {{ matches.length === 1 ? 'match' : 'matches' }}{{ truncated ? '+' : '' }}
          </UBadge>
          <UButton
            v-if="text"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            title="Clear"
            aria-label="Clear test string"
            @click="text = ''"
          />
        </div>
      </div>
      <div class="relative flex-1 min-h-0 mt-1.5 rounded-lg border border-default bg-default overflow-hidden">
        <div ref="backdrop" class="regex-layer text-transparent" aria-hidden="true">
          <span
            v-for="(s, i) in segments"
            :key="i"
            :data-match="s.match >= 0 ? s.match : undefined"
            :class="s.match < 0 ? '' : s.match === active ? 'mark-active' : 'mark'"
            >{{ s.text }}</span
          >
        </div>
        <textarea
          ref="input"
          v-model="text"
          class="regex-layer absolute inset-0 resize-none bg-transparent text-default outline-none placeholder:text-default/30"
          placeholder="Paste the text to match against…"
          spellcheck="false"
          aria-label="Test string"
          @scroll="syncScroll"
          @click="syncCaret"
          @keyup="syncCaret"
        />
      </div>
    </div>

    <!-- Matches -->
    <div class="flex flex-col shrink-0 h-56">
      <div class="flex items-center justify-between h-7 shrink-0">
        <span class="text-sm font-medium text-default/60">Matches</span>
        <CopyButton v-if="matches.length" :value="copyText" />
      </div>
      <div ref="rows" class="flex-1 min-h-0 mt-1.5 rounded-lg border border-default overflow-auto bg-default">
        <table v-if="matches.length" class="w-full text-sm border-collapse">
          <thead class="sticky top-0 bg-muted/80 backdrop-blur text-xs text-default/60">
            <tr>
              <th class="px-3 py-1.5 text-left font-medium w-12">#</th>
              <th class="px-3 py-1.5 text-left font-medium w-20">Index</th>
              <th class="px-3 py-1.5 text-left font-medium">Match</th>
              <th v-for="g in groupCount" :key="g" class="px-3 py-1.5 text-left font-medium">Group {{ g }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-muted">
            <tr
              v-for="(m, i) in matches"
              :key="i"
              :data-row="i"
              class="cursor-pointer transition-colors"
              :class="i === active ? 'bg-primary/10' : 'hover:bg-muted/40'"
              @click="selectMatch(i)"
            >
              <td class="px-3 py-1.5 text-default/40 tabular-nums">{{ i + 1 }}</td>
              <td class="px-3 py-1.5 text-default/60 tabular-nums">{{ m.index }}</td>
              <td class="px-3 py-1.5 font-mono break-all">
                {{ display(m.match) }}
                <span v-for="[k, v] in m.named" :key="k" class="ml-2 text-xs text-default/50">
                  {{ k }}=<span class="text-default/70">{{ display(v) }}</span>
                </span>
              </td>
              <td v-for="g in groupCount" :key="g" class="px-3 py-1.5 font-mono text-default/70 break-all">
                {{ display(m.groups[g - 1] ?? '') }}
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-else
          title="No matches"
          :description="pattern ? 'This pattern found nothing in the test string.' : 'Enter a pattern above to start matching.'"
          class="h-full justify-center"
        />
      </div>
      <p v-if="truncated" class="mt-1.5 text-xs text-warning shrink-0">
        Showing the first {{ MATCH_LIMIT }} matches only.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* The highlight layer and the textarea must lay text out identically, down to
   the pixel, or the marks drift away from the characters they highlight. */
.regex-layer {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 0.75rem;
  border: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875rem;
  line-height: 1.6;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}

.mark,
.mark-active {
  border-radius: 0.2rem;
  /* Padding would shift the text away from the textarea's copy underneath. */
  box-shadow: 0 0 0 1px transparent;
  transition: background-color 0.15s;
}
.mark {
  background-color: color-mix(in oklch, var(--ui-primary) 28%, transparent);
}
.mark-active {
  background-color: color-mix(in oklch, var(--ui-primary) 60%, transparent);
  box-shadow: 0 0 0 1px var(--ui-primary);
}
</style>
