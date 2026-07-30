<script setup lang="ts">
import { ref, reactive, watch, onUnmounted, computed } from 'vue'
import { dominantColors } from '@devdesk/tools'
import { CopyButton } from '@devdesk/ui'
import { UploadCloud } from 'lucide-vue-next'
import { bus } from '@/lib/events'

const FORMATS = [
  { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
  { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
] as const

const original = ref<{ name: string; type: string; size: number; width: number; height: number } | null>(null)
let img: HTMLImageElement | null = null

const opts = reactive({ mime: 'image/webp' as string, quality: 0.8, maxWidth: 0 })
const output = ref<{ url: string; size: number; width: number; height: number } | null>(null)
const palette = ref<string[]>([])
const dragOver = ref(false)

const format = computed(() => FORMATS.find((f) => f.mime === opts.mime)!)
function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
const savings = computed(() => {
  if (!original.value || !output.value) return null
  const diff = original.value.size - output.value.size
  return { diff, pct: Math.round((diff / original.value.size) * 100) }
})

function revoke() {
  if (output.value) URL.revokeObjectURL(output.value.url)
}

async function render() {
  if (!img) return
  const scale = opts.maxWidth > 0 && opts.maxWidth < img.naturalWidth ? opts.maxWidth / img.naturalWidth : 1
  const width = Math.round(img.naturalWidth * scale)
  const height = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  palette.value = dominantColors(ctx.getImageData(0, 0, width, height).data)
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob(res, format.value.mime, format.value.lossy ? opts.quality : undefined),
  )
  if (!blob) return
  revoke()
  output.value = { url: URL.createObjectURL(blob), size: blob.size, width, height }
}

function loadFile(file: File) {
  if (!file.type.startsWith('image/')) {
    bus.emit('toast', { type: 'error', message: 'That is not an image file.' })
    return
  }
  const url = URL.createObjectURL(file)
  const el = new Image()
  el.onload = () => {
    img = el
    original.value = { name: file.name, type: file.type, size: file.size, width: el.naturalWidth, height: el.naturalHeight }
    URL.revokeObjectURL(url)
    void render()
  }
  el.onerror = () => {
    URL.revokeObjectURL(url)
    bus.emit('toast', { type: 'error', message: 'Could not read that image.' })
  }
  el.src = url
}

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) loadFile(file)
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) loadFile(file)
}

// Re-encode whenever a control changes; the source image stays in memory.
watch(opts, () => void render())
onUnmounted(revoke)

function copyColor(c: string) {
  void navigator.clipboard?.writeText(c)
}

function download() {
  if (!output.value || !original.value) return
  const base = original.value.name.replace(/\.[^.]+$/, '')
  const a = document.createElement('a')
  a.href = output.value.url
  a.download = `${base}.${format.value.ext}`
  a.click()
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 gap-4 overflow-auto">
    <!-- Drop zone / picker -->
    <label
      class="shrink-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/60'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <UploadCloud class="size-8 text-default/40" />
      <span class="text-sm text-default/70">
        <span class="font-medium text-primary">Choose an image</span> or drop it here
      </span>
      <span class="text-xs text-default/40">PNG, JPEG, WebP, GIF, SVG — nothing leaves your device</span>
      <input type="file" accept="image/*" class="hidden" @change="onPick" />
    </label>

    <template v-if="original && output">
      <!-- Controls -->
      <div class="flex flex-wrap items-center gap-4 shrink-0">
        <UFieldGroup size="sm">
          <UButton
            v-for="f in FORMATS"
            :key="f.mime"
            type="button"
            color="neutral"
            :variant="opts.mime === f.mime ? 'solid' : 'outline'"
            :aria-pressed="opts.mime === f.mime"
            @click="opts.mime = f.mime"
          >
            {{ f.label }}
          </UButton>
        </UFieldGroup>

        <label v-if="format.lossy" class="flex items-center gap-2 text-sm">
          <span class="text-muted">Quality</span>
          <input v-model.number="opts.quality" type="range" min="0.1" max="1" step="0.05" class="w-36 accent-primary" aria-label="Quality" />
          <span class="w-10 tabular-nums text-default/70">{{ Math.round(opts.quality * 100) }}%</span>
        </label>

        <label class="flex items-center gap-2 text-sm">
          <span class="text-muted">Max width</span>
          <UInput v-model.number="opts.maxWidth" type="number" min="0" size="sm" class="w-24" placeholder="original" />
          <span class="text-xs text-default/40">px · 0 = keep</span>
        </label>
      </div>

      <!-- Preview + stats -->
      <div class="grid gap-4 md:grid-cols-2 shrink-0">
        <div v-for="side in (['original', 'output'] as const)" :key="side" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between h-6">
            <span class="text-sm font-medium text-default/60">{{ side === 'original' ? 'Original' : 'Converted' }}</span>
            <span class="text-xs tabular-nums text-default/50">
              {{ side === 'original' ? `${original.width}×${original.height}` : `${output.width}×${output.height}` }}
              · {{ kb(side === 'original' ? original.size : output.size) }}
            </span>
          </div>
          <div class="flex items-center justify-center rounded-lg border border-default bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2 h-56 overflow-hidden">
            <img :src="output.url" class="max-h-full max-w-full object-contain" :alt="side" />
          </div>
        </div>
      </div>

      <!-- Savings + dominant colours -->
      <div class="flex flex-wrap items-center gap-4 shrink-0">
        <div v-if="savings" class="text-sm">
          <span class="font-medium" :class="savings.diff >= 0 ? 'text-success' : 'text-error'">
            {{ savings.diff >= 0 ? 'Saved' : 'Larger by' }} {{ kb(Math.abs(savings.diff)) }}
          </span>
          <span class="text-default/50"> ({{ savings.pct >= 0 ? '−' : '+' }}{{ Math.abs(savings.pct) }}% vs original)</span>
        </div>
        <div v-if="palette.length" class="flex items-center gap-1.5">
          <span class="text-xs text-default/50">Dominant</span>
          <button
            v-for="c in palette"
            :key="c"
            type="button"
            class="size-6 rounded border border-default"
            :style="{ background: c }"
            :title="`${c} — click to copy`"
            @click="copyColor(c)"
          />
        </div>
        <div class="flex-1" />
        <CopyButton :value="output.url" label="Copy blob URL" />
        <UButton color="primary" size="sm" icon="i-lucide-download" @click="download">
          Download .{{ format.ext }}
        </UButton>
      </div>

      <p class="shrink-0 rounded-lg border border-default bg-muted/40 p-3 text-sm text-default/70">
        <span class="font-medium text-default">Note:</span> Everything runs on this device via a canvas — the image is
        never uploaded. Re-encoding also strips EXIF and other metadata (camera, GPS). Format support depends on your
        browser; WebP and JPEG honour the quality slider, PNG is lossless.
      </p>
    </template>
  </div>
</template>
