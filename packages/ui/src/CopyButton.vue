<script setup lang="ts">
import { ref } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'

const props = defineProps<{ value: string; label?: string }>()
const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    size="sm"
    :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
    :class="copied ? 'text-success' : ''"
    :disabled="!value"
    @click="copy"
  >
    <span v-if="label">{{ copied ? 'Copied' : label }}</span>
  </UButton>
</template>
