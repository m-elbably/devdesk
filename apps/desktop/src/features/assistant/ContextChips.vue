<script setup lang="ts">
import { computed } from 'vue'
import type { ContextItem } from './useAssistant'

const props = defineProps<{
  available: ContextItem[]
  attached: string[]
  /** Set when the provider is remote and the context cannot be sent. */
  blockedReason?: string
}>()

const emit = defineEmits<{ toggle: [id: string] }>()

const isAttached = (id: string) => props.attached.includes(id)
const blocked = computed(() => props.blockedReason !== undefined)
</script>

<template>
  <div v-if="available.length" class="px-3 pb-2">
    <p class="text-xs text-dimmed mb-1.5">
      <template v-if="blocked">This page's context stays here — {{ blockedReason }}</template>
      <template v-else>Add from this page</template>
    </p>
    <div class="flex flex-wrap gap-1.5">
      <UButton
        v-for="item in available"
        :key="item.id"
        size="xs"
        :color="isAttached(item.id) ? 'primary' : 'neutral'"
        :variant="isAttached(item.id) ? 'subtle' : 'outline'"
        :disabled="blocked"
        :icon="isAttached(item.id) ? 'i-lucide-check' : 'i-lucide-plus'"
        @click="emit('toggle', item.id)"
      >
        {{ item.label }}
      </UButton>
    </div>
  </div>
</template>
