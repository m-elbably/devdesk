<script setup lang="ts">
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'

// Thin wrapper over Nuxt UI's Modal (Reka UI dialog): Esc-to-close, focus
// trapping and the top layer come from the library.
// `titleClass` styles the header title (e.g. 'truncate' for titles that would
// otherwise wrap and squeeze the header actions).
const props = defineProps<{ open: boolean; title?: string; boxClass?: string; titleClass?: string }>()
const emit = defineEmits<{ close: [] }>()

const open = computed({
  get: () => props.open,
  set: (v) => {
    if (!v) emit('close')
  },
})
</script>

<template>
  <!-- min-w-0 on the title wrapper is what lets `titleClass="truncate"` actually
       clip: without it the flex item refuses to shrink below its content. -->
  <!-- The built-in close button is absolutely positioned in the header, so it lands on
       top of anything in #actions. Modals that supply their own actions get no × —
       those always include an explicit Close/Cancel, and Esc still works either way. -->
  <UModal
    v-model:open="open"
    :title="title"
    :close="!$slots.actions"
    :ui="{ content: boxClass, title: titleClass, wrapper: 'min-w-0' }"
  >
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>
