<script setup lang="ts">
import UEmpty from '@nuxt/ui/components/Empty.vue'

defineProps<{ title: string; description?: string }>()
</script>

<template>
  <UEmpty :title="title" :description="description" variant="naked" class="py-12">
    <template v-if="$slots.icon" #leading>
      <slot name="icon" />
    </template>
    <template v-if="$slots.action" #actions>
      <slot name="action" />
    </template>
  </UEmpty>
</template>
