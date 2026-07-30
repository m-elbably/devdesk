<script setup lang="ts">
import { computed } from 'vue'

// The colour itself, plus the only question a converter's contrast numbers are
// ever asked to answer: which text colour goes on top, and does it pass WCAG.
const props = defineProps<{ color: string; onWhite: number; onBlack: number }>()

// WCAG 2: 4.5:1 passes AA for body text, 7:1 AAA. 3:1 is the large-text floor.
type Grade = { label: string; color: 'success' | 'warning' | 'error' }
function grade(ratio: number): Grade {
  if (ratio >= 7) return { label: 'AAA', color: 'success' }
  if (ratio >= 4.5) return { label: 'AA', color: 'success' }
  if (ratio >= 3) return { label: 'AA large', color: 'warning' }
  return { label: 'Fails', color: 'error' }
}
const samples = computed(() => [
  { name: 'White text', text: '#ffffff', ratio: props.onWhite, ...grade(props.onWhite) },
  { name: 'Black text', text: '#000000', ratio: props.onBlack, ...grade(props.onBlack) },
])
</script>

<template>
  <div class="flex flex-wrap items-stretch gap-3 rounded-lg border border-default bg-muted/30 p-3">
    <div
      class="size-24 shrink-0 rounded-lg border border-default"
      :style="{ background: color }"
      :title="color"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <div
        v-for="s in samples"
        :key="s.name"
        class="flex flex-1 items-center justify-between gap-3 rounded-md px-3 py-2"
        :style="{ background: color, color: s.text }"
      >
        <span class="truncate text-sm font-medium">The quick brown fox</span>
        <span class="flex shrink-0 items-center gap-2 text-xs tabular-nums">
          {{ s.ratio.toFixed(2) }}:1
          <UBadge :color="s.color" variant="solid" size="sm">{{ s.label }}</UBadge>
        </span>
      </div>
    </div>
  </div>
</template>
