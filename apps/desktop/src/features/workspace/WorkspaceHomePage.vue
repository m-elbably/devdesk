<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Link } from '@tanstack/vue-router'
import { getTool, implementedTools } from '@devdesk/tools'
import type { Note, Snippet, Task } from '@devdesk/shared'
import PageShell from '@/components/PageShell.vue'
import ToolCard from '@/features/tools/ToolCard.vue'
import { services } from '@/services'
import { activeWorkspace, updateWorkspaceHome } from '@/services/workspace'
import { bus } from '@/lib/events'

const tasks = ref<Task[]>([])
const notes = ref<Note[]>([])
const snippets = ref<Snippet[]>([])

async function reload() {
  const [nextTasks, nextNotes, nextSnippets] = await Promise.all([services.tasks.list(), services.notes.list(), services.snippets.list()])
  tasks.value = nextTasks
  notes.value = nextNotes
  snippets.value = nextSnippets
}

let off: (() => void) | undefined
onMounted(() => {
  void reload()
  off = bus.on('entity:mutated', () => reload())
})
onUnmounted(() => off?.())

const home = computed(() => activeWorkspace()?.home ?? { toolIds: [], noteIds: [], snippetIds: [] })
const tools = computed(() => home.value.toolIds.map(getTool).filter(Boolean))
const pinnedNotes = computed(() => notes.value.filter((note) => home.value.noteIds.includes(note.id)))
const pinnedSnippets = computed(() => snippets.value.filter((snippet) => home.value.snippetIds.includes(snippet.id)))
const upNext = computed(() => tasks.value.filter((task) => task.status !== 'done').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')).slice(0, 6))

const toolItems = implementedTools().map((tool) => ({ label: tool.name, value: tool.id }))
const noteItems = computed(() => notes.value.map((note) => ({ label: note.title || 'Untitled note', value: note.id })))
const snippetItems = computed(() => snippets.value.map((snippet) => ({ label: snippet.title || 'Untitled snippet', value: snippet.id })))

/** SelectMenu can emit selected option objects as well as their value keys. Dexie
 * only accepts data-cloneable primitives, so persist the IDs either way. */
function selectedIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values.flatMap((value) => {
    if (typeof value === 'string') return [value]
    if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
      return [(value as { value: string }).value]
    }
    return []
  })
}

async function update(kind: 'toolIds' | 'noteIds' | 'snippetIds', values: unknown) {
  await updateWorkspaceHome({
    toolIds: [...home.value.toolIds],
    noteIds: [...home.value.noteIds],
    snippetIds: [...home.value.snippetIds],
    [kind]: selectedIds(values),
  })
}
</script>

<template>
  <PageShell :title="activeWorkspace()?.name ?? 'Workspace'" subtitle="Your project home">
    <div class="space-y-6 max-w-6xl">
      <section class="grid gap-4 lg:grid-cols-3">
        <UCard class="lg:col-span-2">
          <template #header><h2 class="font-semibold">Up next</h2></template>
          <div v-if="upNext.length" class="divide-y divide-default">
            <Link v-for="task in upNext" :key="task.id" to="/board" class="flex items-center gap-3 py-2 first:pt-0 last:pb-0 hover:text-primary">
              <span class="flex-1 truncate">{{ task.title }}</span>
              <UBadge :color="task.priority === 'urgent' ? 'error' : task.priority === 'high' ? 'warning' : 'neutral'" variant="subtle" size="sm">{{ task.priority }}</UBadge>
              <span v-if="task.dueDate" class="text-xs text-muted">{{ task.dueDate.slice(0, 10) }}</span>
            </Link>
          </div>
          <p v-else class="text-sm text-muted">No open tasks.</p>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold">Project</h2></template>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-muted">Open tasks</dt><dd>{{ tasks.filter((task) => task.status !== 'done').length }}</dd></div>
            <div class="flex justify-between"><dt class="text-muted">Notes</dt><dd>{{ notes.length }}</dd></div>
            <div class="flex justify-between"><dt class="text-muted">Snippets</dt><dd>{{ snippets.length }}</dd></div>
          </dl>
        </UCard>
      </section>

      <section>
        <div class="mb-3 flex items-center justify-between gap-3"><h2 class="font-semibold">Pinned tools</h2><USelectMenu :model-value="home.toolIds" multiple value-key="value" label-key="label" :items="toolItems" placeholder="Pin tools" class="w-60" @update:model-value="update('toolIds', $event)" /></div>
        <div v-if="tools.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><ToolCard v-for="tool in tools" :key="tool!.id" :tool="tool!" /></div>
        <p v-else class="text-sm text-muted">Pin the tools this project uses most.</p>
      </section>

      <section class="grid gap-6 lg:grid-cols-2">
        <div>
          <div class="mb-3 flex items-center justify-between gap-3"><h2 class="font-semibold">Pinned notes</h2><USelectMenu :model-value="home.noteIds" multiple value-key="value" label-key="label" :items="noteItems" placeholder="Pin notes" class="w-52" @update:model-value="update('noteIds', $event)" /></div>
          <div v-if="pinnedNotes.length" class="space-y-2"><Link v-for="note in pinnedNotes" :key="note.id" to="/notes" class="block rounded-lg border border-default bg-default p-3 hover:border-primary"><p class="font-medium">{{ note.title || 'Untitled note' }}</p><p class="mt-1 line-clamp-2 text-sm text-muted">{{ note.body }}</p></Link></div>
          <p v-else class="text-sm text-muted">Pin notes that define this project.</p>
        </div>
        <div>
          <div class="mb-3 flex items-center justify-between gap-3"><h2 class="font-semibold">Pinned snippets</h2><USelectMenu :model-value="home.snippetIds" multiple value-key="value" label-key="label" :items="snippetItems" placeholder="Pin snippets" class="w-52" @update:model-value="update('snippetIds', $event)" /></div>
          <div v-if="pinnedSnippets.length" class="space-y-2"><Link v-for="snippet in pinnedSnippets" :key="snippet.id" to="/snippets" class="block rounded-lg border border-default bg-default p-3 hover:border-primary"><p class="font-medium">{{ snippet.title || 'Untitled snippet' }}</p><p class="mt-1 line-clamp-2 font-mono text-sm text-muted">{{ snippet.code }}</p></Link></div>
          <p v-else class="text-sm text-muted">Pin useful project snippets here.</p>
        </div>
      </section>
    </div>
  </PageShell>
</template>
