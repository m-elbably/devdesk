<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { ToolDefinition } from '@devdesk/shared'
import { getTool } from '@devdesk/tools'
import { EmptyState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import ToolCard from '@/features/tools/ToolCard.vue'
import { services } from '@/services'
import { bus } from '@/lib/events'

const tools = ref<ToolDefinition[]>([])
async function reload() {
  const recent = await services.preferences.recent.list()
  tools.value = recent.map((r) => getTool(r.toolId)).filter((t): t is ToolDefinition => !!t)
}

let off: (() => void) | undefined
onMounted(() => {
  void reload()
  off = bus.on('tool:opened', reload)
})
onUnmounted(() => off?.())
</script>

<template>
  <PageShell title="Recent" subtitle="Recently used tools">
    <div v-if="tools.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ToolCard v-for="tool in tools" :key="tool.id" :tool="tool" />
    </div>
    <EmptyState v-else title="Nothing recent" description="Tools you open show up here." />
  </PageShell>
</template>
