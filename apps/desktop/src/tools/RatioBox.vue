<script setup lang="ts">
import { computed } from 'vue'

// The frame, drawn. "1.7778:1" is a number you have to picture; this is the
// picture — and when a target size is set, the outline shows what the scaled
// box looks like against the original instead of two rows of digits.
const props = defineProps<{ width: number; height: number; scaled?: string }>()

const BOX = 120 // px of height the larger side is allowed

const box = computed(() => {
  const ratio = props.width / props.height
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  // Fit inside a BOX×(BOX*2.4) area: wide ratios stay bounded by width, tall
  // ones by height, so a 9:16 frame doesn't tower over the panel.
  const scale = Math.min((BOX * 2.4) / props.width, BOX / props.height)
  return { w: Math.round(props.width * scale), h: Math.round(props.height * scale), ratio }
})

// "1920 × 1080" from the result row, drawn as a ghost frame over the original.
const target = computed(() => {
  const match = /(\d+)\s*×\s*(\d+)/.exec(props.scaled ?? '')
  if (!match || !box.value) return null
  const w = Number(match[1])
  const h = Number(match[2])
  const scale = Math.min(box.value.w / props.width, box.value.h / props.height)
  return { w: Math.round(w * scale), h: Math.round(h * scale), label: `${w} × ${h}` }
})
</script>

<template>
  <div v-if="box" class="rounded-lg border border-default bg-muted/30 px-4 py-3">
    <div class="flex items-center justify-center" :style="{ minHeight: `${BOX + 8}px` }">
      <div class="relative" :style="{ width: `${box.w}px`, height: `${box.h}px` }">
        <div
          class="flex size-full items-center justify-center rounded border-2 border-primary bg-primary/10 font-mono text-xs text-primary"
          :title="`${width} × ${height}`"
        >
          {{ Math.round(width) }} × {{ Math.round(height) }}
        </div>
        <!-- Scaled result, anchored at the same corner so the size change reads
             as a change rather than two unrelated rectangles. -->
        <div
          v-if="target"
          class="absolute left-0 top-0 rounded border-2 border-dashed border-warning"
          :style="{ width: `${target.w}px`, height: `${target.h}px` }"
          :title="`Scaled: ${target.label}`"
        />
      </div>
    </div>
    <p class="mt-1 text-center text-xs text-default/60">
      {{ Number(box.ratio.toFixed(4)) }}:1
      <span v-if="target" class="text-warning"> · scaled to {{ target.label }}</span>
    </p>
  </div>
</template>
