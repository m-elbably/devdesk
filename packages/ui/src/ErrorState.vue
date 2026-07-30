<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'
import UAlert from '@nuxt/ui/components/Alert.vue'
import UButton from '@nuxt/ui/components/Button.vue'

defineProps<{ message: string }>()
const emit = defineEmits<{ retry: [] }>()

// Declared emit listeners are stripped from $attrs, so peek at vnode.props to
// know whether a retry handler was passed.
const hasRetry = computed(
  () => !!((getCurrentInstance()?.vnode.props ?? {}) as Record<string, unknown>).onRetry,
)
</script>

<template>
  <UAlert color="error" variant="soft" icon="i-lucide-triangle-alert" :title="message">
    <template v-if="hasRetry" #actions>
      <UButton size="xs" color="error" variant="soft" @click="emit('retry')">Retry</UButton>
    </template>
  </UAlert>
</template>
