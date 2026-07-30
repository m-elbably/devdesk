<script setup lang="ts">
import UIcon from '@nuxt/ui/components/Icon.vue'

defineProps<{ label?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-12 text-muted">
    <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" />
    <p v-if="label" class="text-sm">{{ label }}</p>
  </div>
</template>
