<script setup lang="ts">
import { useDark, useToggle } from '@vueuse/core'

// Nuxt UI's color mode (installed by @nuxt/ui/vue-plugin) is vueuse's useDark on
// the same storage key, so toggling here drives every component.
const isDark = useDark()
const toggle = useToggle(isDark)
</script>

<template>
  <UButton
    :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
    color="neutral"
    variant="ghost"
    size="sm"
    :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
    @click="toggle()"
  />
</template>
