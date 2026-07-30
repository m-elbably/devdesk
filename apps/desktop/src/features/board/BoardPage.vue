<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { BOARD_COLUMNS, type Task, type TaskStatus } from '@devdesk/shared'
import { EmptyState, ErrorState, LoadingState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import TaskCard from './TaskCard.vue'
import TaskDialog from './TaskDialog.vue'
import { useBoard } from './useBoard'
import { openRequest } from '@/lib/events'

const board = useBoard()

// Reka UI reserves '' as the "cleared" value and rejects it as an item value,
// so "no filter" needs a sentinel that maps back to the empty filter we store.
const ALL_PRIORITIES = 'all'
const PRIORITY_FILTERS = [
  { label: 'All priorities', value: ALL_PRIORITIES },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]
const priorityFilter = computed({
  get: () => board.priority.value || ALL_PRIORITIES,
  set: (v: string) => (board.priority.value = v === ALL_PRIORITIES ? '' : (v as typeof board.priority.value)),
})

const statusDot: Record<TaskStatus, string> = {
  backlog: 'bg-inverted/40',
  todo: 'bg-info',
  in_progress: 'bg-warning',
  done: 'bg-success',
}

// Local mutable copy for vuedraggable (it needs to reorder arrays in place).
const cols = ref<{ status: TaskStatus; label: string; tasks: Task[] }[]>([])
watch(board.columns, (next) => (cols.value = next.map((c) => ({ ...c, tasks: [...c.tasks] }))), {
  immediate: true,
})

const dialogOpen = ref(false)
const editing = ref<Task | null>(null)
const defaultStatus = ref<TaskStatus>('todo')
const filtersActive = computed(() => !!board.search.value || !!board.priority.value)
const totalByStatus = computed(() => Object.fromEntries(
  BOARD_COLUMNS.map(({ status }) => [status, board.tasks.value.filter((task) => task.status === status).length]),
) as Record<TaskStatus, number>)

function openNew(status: TaskStatus = 'todo') {
  editing.value = null
  defaultStatus.value = status
  dialogOpen.value = true
}
function openEdit(task: Task) {
  editing.value = task
  dialogOpen.value = true
}

function applyOpen() {
  const request = openRequest.value
  if (request?.kind !== 'task') return
  const task = board.tasks.value.find((item) => item.id === request.id)
  if (!task) return
  openEdit(task)
  openRequest.value = null
}
watch(openRequest, applyOpen)
watch(() => board.tasks.value.length, applyOpen)
</script>

<template>
  <PageShell title="Tasks" fluid>
    <template #actions>
      <UInput
        v-model="board.search.value"
        type="search"
        size="sm"
        icon="i-lucide-search"
        placeholder="Search"
        aria-label="Search tasks"
        class="w-48"
      />
      <USelect v-model="priorityFilter" size="sm" :items="PRIORITY_FILTERS" aria-label="Filter by priority" class="w-40" />
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openNew()">Add task</UButton>
    </template>
    <p v-if="filtersActive" class="text-xs text-default/60 mb-4">Clear filters to reorder tasks.</p>

    <LoadingState v-if="board.loading.value" label="Loading tasks…" />
    <ErrorState v-else-if="board.error.value" :message="board.error.value" @retry="board.reload" />
    <EmptyState v-else-if="!board.tasks.value.length" title="No tasks yet" description="Create your first task to start the board.">
      <template #action><UButton color="primary" size="sm" @click="openNew()">Add task</UButton></template>
    </EmptyState>
    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <section v-for="col in cols" :key="col.status" class="flex flex-col gap-2">
        <div class="flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full" :class="statusDot[col.status]" />
            <h2 class="text-xs font-semibold tracking-wider uppercase text-default/70">{{ col.label }}</h2>
          </div>
          <UBadge color="neutral" variant="subtle" size="sm">
            {{ filtersActive ? `${col.tasks.length} of ${totalByStatus[col.status]}` : col.tasks.length }}
          </UBadge>
        </div>
        <draggable
          v-model="col.tasks"
          item-key="id"
          group="tasks"
          class="flex flex-col gap-2 min-h-24 max-h-[calc(100vh-19rem)] overflow-y-auto rounded-lg bg-elevated/40 p-2"
          :animation="150"
          :disabled="filtersActive"
          @change="board.persistColumn(col.status, col.tasks)"
        >
          <template #item="{ element }">
            <TaskCard :task="element" @edit="openEdit(element)" @toggle="board.toggleDone(element)" />
          </template>
          <template #footer>
            <p v-if="!col.tasks.length" class="py-5 text-center text-xs text-default/40">
              {{ filtersActive && totalByStatus[col.status] ? 'No matching tasks' : 'No tasks' }}
            </p>
          </template>
        </draggable>
        <!-- variant="ghost", not "outline": Nuxt UI draws outline with a `ring`, which
             has no dashed style — so the border has to be ours to dash. -->
        <UButton
          block
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          class="border border-dashed border-accented text-default/50 hover:border-primary hover:text-primary"
          @click="openNew(col.status)"
        >
          Add task
        </UButton>
      </section>
    </div>

    <TaskDialog
      :open="dialogOpen"
      :task="editing"
      :default-status="defaultStatus"
      @close="dialogOpen = false"
    />
  </PageShell>
</template>
