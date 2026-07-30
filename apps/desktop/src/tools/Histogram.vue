<script setup lang="ts">
import { computed } from 'vue'
import { parseNumbers, percentileOf } from '@devdesk/tools'

// The shape of a pasted number list. A table of mean/median/p95 is correct but
// says nothing about *why* they differ — one long tail, two clusters, or a few
// wild outliers all read the same as summary rows and completely different here.
const props = defineProps<{ text: string }>()

const sorted = computed(() => parseNumbers(props.text).sort((a, b) => a - b))

const chart = computed(() => {
  const values = sorted.value
  if (values.length < 2) return null
  const min = values[0]!
  const max = values[values.length - 1]!
  if (min === max) return null // every value identical — a single bar says nothing

  // √n buckets, the usual rule of thumb, capped so bars stay wide enough to see.
  const count = Math.min(24, Math.max(5, Math.ceil(Math.sqrt(values.length))))
  const width = (max - min) / count
  const buckets = Array.from({ length: count }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    total: 0,
  }))
  // The maximum lands one bucket past the end; clamp it back into the last one.
  for (const v of values) buckets[Math.min(count - 1, Math.floor((v - min) / width))]!.total++

  const peak = Math.max(...buckets.map((b) => b.total))
  const p95 = percentileOf(values, 95)
  return {
    min,
    max,
    peak,
    median: percentileOf(values, 50),
    p95,
    // Bars past p95 are the tail — the part that decides how a service feels.
    bars: buckets.map((b) => ({ ...b, height: (b.total / peak) * 100, tail: b.from >= p95 })),
  }
})

const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('en-US')
// Position along the value axis, as a percentage of the chart width.
const at = (v: number) => ((v - chart.value!.min) / (chart.value!.max - chart.value!.min)) * 100
</script>

<template>
  <div v-if="chart" class="rounded-lg border border-default bg-muted/30 px-4 py-3">
    <div class="relative flex h-24 items-end gap-px">
      <div
        v-for="(bar, i) in chart.bars"
        :key="i"
        class="flex-1 rounded-t-sm transition-all"
        :class="bar.tail ? 'bg-warning/70' : 'bg-primary/70'"
        :style="{ height: `${Math.max(bar.height, bar.total ? 3 : 0)}%` }"
        :title="`${fmt(bar.from)} – ${fmt(bar.to)}: ${bar.total} value${bar.total === 1 ? '' : 's'}`"
      />
      <!-- Median and p95 drawn where they actually fall, so the gap between them
           (the skew) is visible rather than something you compute in your head. -->
      <span
        v-for="marker in [
          { value: chart.median, label: 'p50', color: 'success' },
          { value: chart.p95, label: 'p95', color: 'warning' },
        ]"
        :key="marker.label"
        class="pointer-events-none absolute inset-y-0 border-l border-dashed"
        :class="`border-${marker.color}`"
        :style="{ left: `${at(marker.value)}%` }"
      >
        <span class="absolute -top-0.5 left-1 text-[10px] leading-none" :class="`text-${marker.color}`">
          {{ marker.label }}
        </span>
      </span>
    </div>
    <div class="mt-1.5 flex items-center justify-between font-mono text-[11px] text-default/50">
      <span>{{ fmt(chart.min) }}</span>
      <span class="font-sans text-default/60">
        {{ sorted.length.toLocaleString('en-US') }} values · peak bucket {{ chart.peak }}
      </span>
      <span>{{ fmt(chart.max) }}</span>
    </div>
  </div>
</template>
