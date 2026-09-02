<script setup lang="ts">
import { ref, watch } from 'vue'
import { BaseModal, EmptyState } from '@devdesk/ui'
import { relativeTime } from '@devdesk/utils'
import type { ToolHistoryEntry } from '@devdesk/database'
import { services } from '@/services'

const props = defineProps<{ toolId: string | null; open: boolean }>()
const emit = defineEmits<{ close: []; restore: [input: Record<string, unknown>] }>()

const entries = ref<ToolHistoryEntry[]>([])

// Load on open (and on tool change while open) rather than once — ToolRunner
// writes new rows behind this dialog's back, so a cached list goes stale.
watch(
  () => [props.open, props.toolId],
  async () => {
    entries.value = props.open && props.toolId ? await services.toolUsage.history.byTool(props.toolId) : []
  },
  { immediate: true },
)

// A run is identified by what was typed, not by the output — the output can be
// a key/value object, an array, or a 4KB PEM blob, none of which read well in a
// one-line row. Skip empty/default-ish values so the summary is the real input.
function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return String(input ?? '')
  return (
    Object.entries(input as Record<string, unknown>)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ') || 'empty input'
  )
}

const when = (iso: string) => relativeTime(Date.parse(iso) / 1000)

function restore(entry: ToolHistoryEntry) {
  if (entry.input && typeof entry.input === 'object') {
    emit('restore', entry.input as Record<string, unknown>)
    emit('close')
  }
}

async function clearAll() {
  if (!props.toolId) return
  await services.toolUsage.history.clear(props.toolId)
  entries.value = []
}
</script>

<template>
  <BaseModal :open="open" title="Recent runs" box-class="max-w-2xl w-full" @close="emit('close')">
    <template #actions>
      <div class="ml-auto flex items-center gap-1">
        <UButton
          v-if="entries.length"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-trash-2"
          class="hover:text-error"
          title="Clear this tool's history"
          @click="clearAll"
        >
          Clear
        </UButton>
        <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" title="Close" aria-label="Close" @click="emit('close')" />
      </div>
    </template>

    <EmptyState
      v-if="!entries.length"
      title="No history yet"
      description="Runs of this tool are saved here so you can pick one back up."
    />
    <ul v-else class="max-h-[60vh] overflow-y-auto divide-y divide-muted">
      <li v-for="e in entries" :key="e.id">
        <UButton
          block
          color="neutral"
          variant="ghost"
          class="h-auto flex-col items-start gap-0.5 rounded-none px-3 py-2 text-left"
          title="Load these inputs back into the tool"
          @click="restore(e)"
        >
          <span v-if="e.label" class="text-xs font-medium text-primary">{{ e.label }}</span>
          <span class="font-mono text-sm break-all line-clamp-2 w-full">{{ summarize(e.input) }}</span>
          <span class="text-xs text-default/50">{{ when(e.createdAt) }}</span>
        </UButton>
      </li>
    </ul>
  </BaseModal>
</template>
