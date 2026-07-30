<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

// A validity span with "now" marked on it. Two ISO dates in a key/value table
// tell you when something expires; this tells you whether it already has, and
// how much of the window is gone — the thing you actually squint at the dates for.
const props = defineProps<{
  from: number
  to: number
  fromLabel?: string
  toLabel?: string
}>()

// Certificates and tokens are read for minutes at a time, so the marker would
// otherwise freeze at page load. 30s is well under the resolution of the bar.
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 30_000)
onUnmounted(() => clearInterval(timer))

const span = computed(() => Math.max(1, props.to - props.from))
const elapsed = computed(() => now.value - props.from)
// The marker is clamped to the track; `state` is what tells you it was clamped.
const pct = computed(() => Math.min(100, Math.max(0, (elapsed.value / span.value) * 100)))
const state = computed(() =>
  now.value > props.to ? 'past' : now.value < props.from ? 'future' : 'inside',
)
const color = computed(() =>
  state.value === 'past' ? 'error' : state.value === 'future' ? 'warning' : pct.value > 90 ? 'warning' : 'success',
)

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]
function relative(ms: number): string {
  const delta = ms - now.value
  const [unit, size] = RELATIVE_UNITS.find(([, s]) => Math.abs(delta) >= s) ?? RELATIVE_UNITS.at(-1)!
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(delta / size), unit)
}
const short = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const caption = computed(() => {
  if (state.value === 'past') return `Ended ${relative(props.to)}`
  if (state.value === 'future') return `Starts ${relative(props.from)}`
  return `${Math.round(pct.value)}% elapsed · ends ${relative(props.to)}`
})
</script>

<template>
  <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
    <div class="flex items-baseline justify-between gap-4 text-xs text-default/60">
      <span class="truncate">{{ fromLabel ?? 'From' }} · <span class="text-default">{{ short(from) }}</span></span>
      <span class="truncate text-right">{{ toLabel ?? 'To' }} · <span class="text-default">{{ short(to) }}</span></span>
    </div>

    <div class="relative mt-2 h-2 rounded-full bg-elevated">
      <div class="h-full rounded-full transition-all duration-300" :class="`bg-${color}`" :style="{ width: `${pct}%` }" />
      <span
        class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-default shadow"
        :class="`bg-${color}`"
        :style="{ left: `${pct}%` }"
        :title="`Now — ${short(now)}`"
      />
    </div>

    <p class="mt-2 text-xs" :class="`text-${color}`">{{ caption }}</p>
  </div>
</template>
