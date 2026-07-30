<script setup lang="ts">
import { computed } from 'vue'
import UBadge from '@nuxt/ui/components/Badge.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import type { PrivacyLevel } from '@devdesk/shared'

const props = defineProps<{ level: PrivacyLevel }>()

type BadgeColor = 'neutral' | 'warning' | 'error'
const META: Record<PrivacyLevel, { color: BadgeColor; variant: 'subtle' | 'soft'; label: string; tip: string }> = {
  PUBLIC: { color: 'neutral', variant: 'subtle', label: 'Public', tip: 'Inputs may be saved to history and synced.' },
  LOCAL_ONLY: { color: 'warning', variant: 'soft', label: 'Local only', tip: 'Stays on this device, never synced.' },
  NEVER_PERSIST: { color: 'error', variant: 'soft', label: 'Never stored', tip: 'Nothing is written to disk.' },
}
const meta = computed(() => META[props.level])
</script>

<template>
  <UTooltip :text="meta.tip">
    <UBadge :color="meta.color" :variant="meta.variant" size="sm">{{ meta.label }}</UBadge>
  </UTooltip>
</template>
