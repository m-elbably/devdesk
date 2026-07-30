<script setup lang="ts">
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'

// Thin wrapper over Nuxt UI's Modal (Reka UI dialog): Esc-to-close, focus
// trapping and the top layer come from the library.
const props = defineProps<{ open: boolean; title?: string; boxClass?: string }>()
const emit = defineEmits<{ close: [] }>()

const open = computed({
  get: () => props.open,
  set: (v) => {
    if (!v) emit('close')
  },
})
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: boxClass }">
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <template #body>
      <slot />
    </template>
  </UModal>
</template>
