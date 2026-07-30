<script setup lang="ts">
import { computed, ref } from 'vue'
import { useParams } from '@tanstack/vue-router'
import { CATEGORY_LABELS, type ToolCategory } from '@devdesk/shared'
import { searchTools } from '@devdesk/tools'
import { EmptyState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import { CATEGORY_ICONS } from '@/lib/navigation'
import ToolCard from './ToolCard.vue'

const params = useParams({ strict: false }) as { value: { category: ToolCategory } }
const category = computed(() => params.value.category)
const query = ref('')

const results = computed(() => searchTools(query.value, { category: category.value }))
const subtitle = computed(() => `${results.value.length} tool${results.value.length === 1 ? '' : 's'}`)

// Split into sub-groups (e.g. Crypto → Generators / Hashing / Encryption), keeping
// catalog order. Categories without groups yield one headerless section.
const groups = computed(() => {
  const map = new Map<string, typeof results.value>()
  for (const t of results.value) {
    const key = t.group ?? ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return [...map.entries()].map(([name, tools]) => ({ name, tools }))
})
</script>

<template>
  <PageShell :title="CATEGORY_LABELS[category] ?? 'Tools'" :subtitle="subtitle" :icon="CATEGORY_ICONS[category]">
    <template #actions>
      <UInput v-model="query" icon="i-lucide-search" size="sm" placeholder="Filter tools" aria-label="Filter tools" />
    </template>

    <div v-if="results.length" class="space-y-6">
      <section v-for="g in groups" :key="g.name">
        <h2 v-if="g.name" class="text-xs font-semibold uppercase tracking-wide text-dimmed mb-2">{{ g.name }}</h2>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ToolCard v-for="tool in g.tools" :key="tool.id" :tool="tool" />
        </div>
      </section>
    </div>
    <EmptyState v-else title="No tools found" :description="`Nothing matches “${query}”.`" />
  </PageShell>
</template>
