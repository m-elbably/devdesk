<script setup lang="ts">
import { computed, reactive, ref, onUnmounted } from 'vue'
import { gradientCss, type GradientSpec, type GradientStop } from '@devdesk/tools'
import { CopyButton } from '@devdesk/ui'

const TYPES: GradientSpec['type'][] = ['linear', 'radial', 'conic']

const spec = reactive<GradientSpec>({
  type: 'linear',
  angle: 90,
  repeating: false,
  stops: [
    { color: '#3b82f6', position: 0 },
    { color: '#8b5cf6', position: 100 },
  ],
})

// The main preview shows the real gradient; the thin handle bar is always a
// 90deg linear of the same stops, so dragging a handle maps straight to a
// position regardless of whether the gradient is radial or conic.
const css = computed(() => gradientCss(spec))
const barCss = computed(
  () =>
    `linear-gradient(90deg, ${[...spec.stops]
      .sort((a, b) => a.position - b.position)
      .map((s) => `${s.color} ${s.position}%`)
      .join(', ')})`,
)

const bar = ref<HTMLElement | null>(null)
let dragging = -1

function positionFromEvent(e: PointerEvent): number {
  const rect = bar.value!.getBoundingClientRect()
  return Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
}
function onMove(e: PointerEvent) {
  if (dragging >= 0) spec.stops[dragging]!.position = positionFromEvent(e)
}
function stopDrag() {
  dragging = -1
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', stopDrag)
}
function startDrag(i: number, e: PointerEvent) {
  e.stopPropagation()
  dragging = i
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stopDrag)
}
onUnmounted(stopDrag)

// Click empty space on the bar to drop a new stop there, inheriting the colour
// of its nearest existing neighbour so it reads as "split this stop".
function addStopAt(e: PointerEvent) {
  const position = positionFromEvent(e)
  const nearest = [...spec.stops].sort(
    (a, b) => Math.abs(a.position - position) - Math.abs(b.position - position),
  )[0]
  spec.stops.push({ color: nearest?.color ?? '#000000', position })
}
function removeStop(i: number) {
  if (spec.stops.length > 2) spec.stops.splice(i, 1)
}
function updateStop(i: number, patch: Partial<GradientStop>) {
  Object.assign(spec.stops[i]!, patch)
}

const exports = computed(() => ({
  'CSS': `background-image: ${css.value};`,
  'CSS (shorthand)': `background: ${css.value};`,
  'Tailwind': `bg-[${css.value.replace(/ /g, '_')}]`,
}))
</script>

<template>
  <div class="flex flex-col h-full min-h-0 gap-4 overflow-auto">
    <!-- The real gradient, big -->
    <div class="shrink-0 h-40 rounded-lg border border-default" :style="{ backgroundImage: css }" />

    <!-- Handle bar: drag a stop to move it, click empty space to add one -->
    <div class="shrink-0">
      <div
        ref="bar"
        class="relative h-8 rounded-md border border-default cursor-copy"
        :style="{ backgroundImage: barCss }"
        @pointerdown="addStopAt"
      >
        <button
          v-for="(s, i) in spec.stops"
          :key="i"
          type="button"
          class="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30 cursor-grab active:cursor-grabbing"
          :style="{ left: `${s.position}%`, background: s.color }"
          :title="`${s.color} at ${s.position}% — drag to move`"
          :aria-label="`Gradient stop ${i + 1}`"
          @pointerdown="startDrag(i, $event)"
        />
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-3 shrink-0">
      <UFieldGroup size="sm">
        <UButton
          v-for="t in TYPES"
          :key="t"
          type="button"
          color="neutral"
          :variant="spec.type === t ? 'solid' : 'outline'"
          :aria-pressed="spec.type === t"
          @click="spec.type = t"
        >
          {{ t.charAt(0).toUpperCase() + t.slice(1) }}
        </UButton>
      </UFieldGroup>

      <label v-if="spec.type !== 'radial'" class="flex items-center gap-2 text-sm">
        <span class="text-muted">Angle</span>
        <input v-model.number="spec.angle" type="range" min="0" max="360" class="w-40 accent-primary" aria-label="Angle" />
        <span class="w-12 tabular-nums text-default/70">{{ spec.angle }}°</span>
      </label>

      <UCheckbox v-model="spec.repeating" size="sm" label="Repeating" />
    </div>

    <!-- Stop editor -->
    <div class="shrink-0 flex flex-col gap-2">
      <div class="flex items-center justify-between h-6">
        <span class="text-sm font-medium text-default/60">Stops</span>
        <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-plus" @click="spec.stops.push({ color: '#ffffff', position: 50 })">
          Add stop
        </UButton>
      </div>
      <div
        v-for="(s, i) in spec.stops"
        :key="i"
        class="flex items-center gap-2 rounded-md border border-default bg-default px-2 py-1.5"
      >
        <input
          type="color"
          class="size-7 shrink-0 rounded border border-default bg-transparent p-0.5"
          :value="/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#000000'"
          aria-label="Stop color"
          @input="updateStop(i, { color: ($event.target as HTMLInputElement).value })"
        />
        <UInput
          :model-value="s.color"
          size="sm"
          class="w-32 font-mono"
          aria-label="Stop color value"
          @update:model-value="updateStop(i, { color: String($event) })"
        />
        <input v-model.number="s.position" type="range" min="0" max="100" class="flex-1 accent-primary" aria-label="Stop position" />
        <span class="w-12 shrink-0 text-right text-sm tabular-nums text-default/70">{{ s.position }}%</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-trash-2"
          class="hover:text-error"
          :disabled="spec.stops.length <= 2"
          title="Remove stop"
          aria-label="Remove stop"
          @click="removeStop(i)"
        />
      </div>
    </div>

    <!-- Output -->
    <div class="flex flex-col min-h-0 gap-2">
      <div
        v-for="(value, label) in exports"
        :key="label"
        class="flex items-center gap-2 rounded-lg border border-default bg-muted/30 px-3 py-2"
      >
        <span class="w-28 shrink-0 text-xs font-medium text-default/60">{{ label }}</span>
        <code class="flex-1 min-w-0 truncate font-mono text-sm" :title="value">{{ value }}</code>
        <CopyButton :value="value" />
      </div>
    </div>
  </div>
</template>
