<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { bus } from '@/lib/events'

// Bridges the app's event bus onto Nuxt UI's toaster (rendered by UApp).
const toast = useToast()

let off: (() => void) | undefined
onMounted(() => {
  off = bus.on('toast', (t) => {
    toast.add({ title: t.message, color: t.type, duration: 2500 })
  })
})
onUnmounted(() => off?.())
</script>

<template>
  <span class="hidden" aria-hidden="true" />
</template>
