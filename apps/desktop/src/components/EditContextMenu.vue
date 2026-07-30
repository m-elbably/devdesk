<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { bus } from '@/lib/events'
import { getSelectionText, selectAll, copySelection, pasteText, deleteSelection } from '@/lib/editableField'

// Menu's own footprint (min-w-36 = 144px, 4 items ~34px tall + py-1 padding) — clamped so it never opens off-screen.
const MENU_W = 150
const MENU_H = 150

const open = ref(false)
const x = ref(0)
const y = ref(0)
const selected = ref(false)
let target: HTMLElement | null = null

function close() {
  open.value = false
  target = null
}

function show({ x: px, y: py, target: el }: { x: number; y: number; target: HTMLElement }) {
  target = el
  selected.value = getSelectionText(el).length > 0
  x.value = Math.min(px, window.innerWidth - MENU_W)
  y.value = Math.min(py, window.innerHeight - MENU_H)
  open.value = true
}

async function run(action: (el: HTMLElement) => void | Promise<void>) {
  if (target) await action(target)
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let off: (() => void) | undefined
onMounted(() => {
  off = bus.on('edit-menu:open', show)
  window.addEventListener('mousedown', close)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('blur', close)
})
onUnmounted(() => {
  off?.()
  window.removeEventListener('mousedown', close)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <div
    v-if="open"
    class="fixed z-50 min-w-36 rounded-md border border-default bg-default py-1 shadow-lg"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mousedown.stop
  >
    <button
      type="button"
      class="block w-full px-3 py-1.5 text-left text-sm text-default hover:bg-elevated disabled:opacity-40 disabled:pointer-events-none"
      :disabled="!selected"
      @click="run(copySelection)"
    >
      Copy
    </button>
    <button type="button" class="block w-full px-3 py-1.5 text-left text-sm text-default hover:bg-elevated" @click="run(pasteText)">
      Paste
    </button>
    <button
      type="button"
      class="block w-full px-3 py-1.5 text-left text-sm text-default hover:bg-elevated disabled:opacity-40 disabled:pointer-events-none"
      :disabled="!selected"
      @click="run(deleteSelection)"
    >
      Delete
    </button>
    <button type="button" class="block w-full px-3 py-1.5 text-left text-sm text-default hover:bg-elevated" @click="run((el) => selectAll(el))">
      Select All
    </button>
  </div>
</template>
