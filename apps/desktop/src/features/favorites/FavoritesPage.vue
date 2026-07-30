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
  const favs = await services.preferences.favorites.list()
  tools.value = favs.map((f) => getTool(f.toolId)).filter((t): t is ToolDefinition => !!t)
}

let off: (() => void) | undefined
onMounted(() => {
  void reload()
  off = bus.on('favorite:changed', reload)
})
onUnmounted(() => off?.())
</script>

<template>
  <PageShell title="Favorites" subtitle="Your pinned tools">
    <div v-if="tools.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ToolCard v-for="tool in tools" :key="tool.id" :tool="tool" />
    </div>
    <EmptyState v-else title="No favorites yet" description="Pin a tool with the ☆ button to see it here." />
  </PageShell>
</template>
