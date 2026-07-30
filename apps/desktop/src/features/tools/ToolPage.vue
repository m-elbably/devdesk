<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useParams } from '@tanstack/vue-router'
import { Star } from 'lucide-vue-next'
import { getToolByRoute } from '@devdesk/tools'
import { PrivacyBadge, EmptyState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import { CATEGORY_ICONS, TOOL_ICONS } from '@/lib/navigation'
import { TOOL_COMPONENTS } from '@/tools/components'
import { TOOL_UI } from '@/tools/ui-spec'
import { hasToolInfo } from '@/tools/info'
import ToolRunner from '@/tools/ToolRunner.vue'
import ToolInfoDialog from './ToolInfoDialog.vue'
import ToolHistoryDialog from './ToolHistoryDialog.vue'
import { services } from '@/services'

const params = useParams({ strict: false }) as { value: { category: string; toolId: string } }
const tool = computed(() => getToolByRoute(`/tools/${params.value.category}/${params.value.toolId}`))
const component = computed(() => (tool.value ? TOOL_COMPONENTS[tool.value.id] : undefined))
const hasRunner = computed(() => !!tool.value && !!TOOL_UI[tool.value.id])
// Bespoke components (e.g. the JSON Editor) render their own full-height layout,
// so the page still needs to be a stretching flex column rather than static.
const fillPage = computed(() => !!tool.value && tool.value.isImplemented && (hasRunner.value || !!component.value))
const runner = ref<InstanceType<typeof ToolRunner> | null>(null)
// The bespoke JSON Editor exposes copy/paste so we can place those actions in
// the page header, matching how other tools surface them.
const jsonEditor = ref<{ copy: () => void; paste: () => void; clear: () => void } | null>(null)
const isJsonEditor = computed(() => tool.value?.id === 'json-editor')

const isFavorite = ref(false)
const infoOpen = ref(false)
const historyOpen = ref(false)
// Only the generic runner can take inputs back; bespoke components (JSON editor,
// regex tester) own their own state and have no loadModel to restore into.
const canShowHistory = computed(
  () => !!tool.value?.isImplemented && !!tool.value?.supportsHistory && hasRunner.value && !component.value,
)

// Track recent usage + favorite state whenever the active tool changes.
async function onTool() {
  if (!tool.value) return
  await services.toolUsage.open(tool.value.id)
  isFavorite.value = await services.preferences.favorites.isFavorite(tool.value.id)
}
onMounted(onTool)
watch(() => tool.value?.id, onTool)

async function toggleFavorite() {
  if (tool.value) isFavorite.value = await services.preferences.toggleFavorite(tool.value.id)
}
</script>

<template>
  <PageShell
    v-if="tool"
    compact
    :title="tool.name"
    :subtitle="tool.description"
    :icon="TOOL_ICONS[tool.id] ?? CATEGORY_ICONS[tool.category]"
    :fill="fillPage"
    fluid
  >
    <template #actions>
      <UButton
        v-if="hasToolInfo(tool.id)"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-info"
        title="About this tool"
        aria-label="About this tool"
        @click="infoOpen = true"
      />
      <UButton
        v-if="canShowHistory"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-history"
        title="Recent runs"
        aria-label="Recent runs"
        @click="historyOpen = true"
      />
      <template v-if="isJsonEditor">
        <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-clipboard-paste" title="Paste" aria-label="Paste" @click="jsonEditor?.paste()" />
        <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" title="Copy" aria-label="Copy" @click="jsonEditor?.copy()" />
      </template>
      <div
        v-if="(tool.isImplemented && hasRunner && !component) || isJsonEditor"
        class="w-px self-stretch bg-elevated mx-0.5 my-1"
      />
      <UButton
        v-if="(tool.isImplemented && hasRunner && !component) || isJsonEditor"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-eraser"
        class="hover:text-error"
        title="Clear all"
        aria-label="Clear all"
        @click="isJsonEditor ? jsonEditor?.clear() : runner?.resetModel()"
      />
      <UButton
        :color="isFavorite ? 'warning' : 'neutral'"
        :variant="isFavorite ? 'soft' : 'ghost'"
        size="sm"
        square
        :title="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
        :aria-label="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
        :aria-pressed="isFavorite"
        @click="toggleFavorite"
      >
        <Star class="size-4" :fill="isFavorite ? 'currentColor' : 'none'" />
      </UButton>
      <PrivacyBadge :level="tool.privacyLevel" />
    </template>

    <div v-if="tool.isImplemented && component" class="h-full min-h-0">
      <component :is="component" ref="jsonEditor" />
    </div>
    <ToolRunner v-else-if="tool.isImplemented && hasRunner" ref="runner" :tool-id="tool.id" />
    <EmptyState v-else title="Coming soon" description="This tool isn't implemented yet." />
  </PageShell>

  <PageShell v-else title="Tool not found">
    <EmptyState title="Unknown tool" description="This tool doesn't exist in the registry." />
  </PageShell>

  <ToolInfoDialog :tool-id="tool?.id ?? null" :open="infoOpen" @close="infoOpen = false" />
  <ToolHistoryDialog
    :tool-id="tool?.id ?? null"
    :open="historyOpen"
    @close="historyOpen = false"
    @restore="runner?.loadModel($event)"
  />
</template>
