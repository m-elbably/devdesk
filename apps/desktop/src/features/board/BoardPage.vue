<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { BOARD_COLUMNS, type Task, type TaskPriority, type TaskStatus } from '@devdesk/shared'
import { BaseModal, EmptyState, ErrorState, LoadingState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import TaskCard from './TaskCard.vue'
import TaskDialog from './TaskDialog.vue'
import ImportDialog from './ImportDialog.vue'
import { moveSelectedTasks } from './moveSelectedTasks'
import { useBoard } from './useBoard'
import type { ParsedTask } from './markdownTasks'
import { bus, openRequest } from '@/lib/events'

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
const statusIcon: Record<TaskStatus, string> = {
  backlog: 'i-lucide-inbox',
  todo: 'i-lucide-circle',
  in_progress: 'i-lucide-loader-circle',
  done: 'i-lucide-circle-check',
}

// Local mutable copy for vuedraggable (it needs to reorder arrays in place).
const cols = ref<{ status: TaskStatus; label: string; tasks: Task[] }[]>([])
watch(board.columns, (next) => (cols.value = next.map((c) => ({ ...c, tasks: [...c.tasks] }))), {
  immediate: true,
})

const dialogOpen = ref(false)
const importOpen = ref(false)
const editing = ref<Task | null>(null)
const viewing = ref<Task | null>(null)
const deleting = ref<Task[]>([])
const deleteBusy = ref(false)
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

/**
 * Bulk actions over the ticked cards. Reordering is position-based, so the move
 * actions stay out of here — status, priority and delete are the ones that make
 * sense applied to a whole selection at once.
 */
const bulkItems = computed(() => {
  const list = board.selected.value
  return [
    BOARD_COLUMNS.map(({ status, label }) => ({
      label: `Move to ${label}`,
      icon: statusIcon[status],
      onSelect: () => board.updateMany(list, { status }),
    })),
    (['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((priority) => ({
      label: `Set ${priority} priority`,
      icon: 'i-lucide-flag',
      onSelect: () => board.updateMany(list, { priority }),
    })),
    [
      { label: 'Clear selection', icon: 'i-lucide-x', onSelect: () => board.clearSelection() },
      {
        label: `Delete ${list.length} task(s)`,
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => (deleting.value = [...list]),
      },
    ],
  ]
})

// A task's own "Delete" only takes its whole selection with it when it's part of
// one — right-clicking an unselected card while others are ticked shouldn't nuke them too.
function removeTask(task: Task) {
  deleting.value =
    board.selectedIds.value.has(task.id) && board.selected.value.length > 1
      ? [...board.selected.value]
      : [task]
}

function editViewing() {
  const task = viewing.value
  viewing.value = null
  if (task) openEdit(task)
}

// The dialog stays up (and keeps its wording) until the delete lands, rather than
// closing first and re-rendering its own message against an emptied list.
async function confirmDelete() {
  deleteBusy.value = true
  await board.removeMany(deleting.value)
  deleteBusy.value = false
  deleting.value = []
}

async function runImport(parsed: ParsedTask[]) {
  importOpen.value = false
  await board.importTasks(parsed)
  if (!board.error.value) {
    bus.emit('toast', { type: 'success', message: `Imported ${parsed.length} task(s)` })
  }
}

let draggedTasks: Task[] = []

function startBoardDrag(event: { item: HTMLElement }) {
  const id = event.item.dataset.taskId
  draggedTasks = id && board.selectedIds.value.has(id)
    ? cols.value.flatMap((column) => column.tasks.filter((task) => board.selectedIds.value.has(task.id)))
    : []
}

async function persistBoard(event: { from: HTMLElement; to: HTMLElement; item: HTMLElement; newIndex?: number }) {
  const statuses = new Set([event.from.dataset.status, event.to.dataset.status])
  const selected = draggedTasks
  draggedTasks = []
  if (selected.length > 1) {
    const status = event.to.dataset.status as TaskStatus
    const target = cols.value.find((column) => column.status === status)
    const droppedAt = event.newIndex ?? target?.tasks.findIndex((task) => task.id === event.item.dataset.taskId) ?? -1
    moveSelectedTasks(cols.value, selected, status, droppedAt).forEach((status) => statuses.add(status))
  }
  await Promise.all(
    [...statuses].flatMap((status) => {
      const column = cols.value.find((col) => col.status === status)
      return column ? [board.persistColumn(column.status, [...column.tasks])] : []
    }),
  )
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
  <PageShell title="Tasks" fluid fill>
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
      <UDropdownMenu v-if="board.selected.value.length" :items="bulkItems">
        <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-list-checks" trailing-icon="i-lucide-chevron-down">
          {{ board.selected.value.length }} selected
        </UButton>
      </UDropdownMenu>
      <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-file-down" @click="importOpen = true">
        Import
      </UButton>
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openNew()">Add task</UButton>
    </template>
    <!-- Full-height flex column: the board fills whatever the window gives it and each
         column scrolls internally, instead of reserving a guessed slice of the viewport. -->
    <div class="flex h-full min-h-0 flex-col">
      <p v-if="filtersActive" class="text-xs text-default/60 mb-4 shrink-0">Clear filters to reorder tasks.</p>

      <LoadingState v-if="board.loading.value" label="Loading tasks…" />
      <ErrorState v-else-if="board.error.value" :message="board.error.value" @retry="board.reload" />
      <EmptyState v-else-if="!board.tasks.value.length" title="No tasks yet" description="Create your first task to start the board.">
        <template #action><UButton color="primary" size="sm" @click="openNew()">Add task</UButton></template>
      </EmptyState>
      <div v-else class="grid flex-1 min-h-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section v-for="col in cols" :key="col.status" class="flex min-h-0 flex-col gap-2">
          <div class="flex items-center justify-between px-1 shrink-0">
            <div class="flex items-center gap-2">
              <UCheckbox
                :model-value="board.selectionState(col.tasks)"
                size="sm"
                :disabled="!col.tasks.length"
                :aria-label="`Select all in ${col.label}`"
                @update:model-value="board.toggleMany(col.tasks)"
              />
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
            :data-status="col.status"
            class="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto rounded-lg bg-elevated/40 p-2"
            :animation="150"
            :disabled="filtersActive"
            @start="startBoardDrag"
            @end="persistBoard"
          >
            <template #item="{ element }">
              <div :data-task-id="element.id">
                <TaskCard
                  :task="element"
                  :selected="board.selectedIds.value.has(element.id)"
                  :selected-count="board.selected.value.length"
                  :can-move-up="!filtersActive && board.canMove(element, -1)"
                  :can-move-down="!filtersActive && board.canMove(element, 1)"
                  @edit="openEdit(element)"
                  @select="board.toggleSelect(element)"
                  @view="viewing = element"
                  @move="board.moveBy(element, $event)"
                  @remove="removeTask(element)"
                />
              </div>
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
            class="shrink-0 border border-dashed border-accented text-default/50 hover:border-primary hover:text-primary"
            @click="openNew(col.status)"
          >
            Add task
          </UButton>
        </section>
      </div>
    </div>

    <TaskDialog
      :open="dialogOpen"
      :task="editing"
      :default-status="defaultStatus"
      @close="dialogOpen = false"
    />

    <ImportDialog :open="importOpen" @close="importOpen = false" @import="runImport" />

    <BaseModal
      :open="!!viewing"
      :title="viewing?.title"
      box-class="max-w-2xl w-full"
      @close="viewing = null"
    >
      <div v-if="viewing" class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="neutral" variant="subtle" size="sm">{{ viewing.status.replace('_', ' ') }}</UBadge>
          <UBadge color="neutral" variant="subtle" size="sm">{{ viewing.priority }}</UBadge>
          <UBadge v-for="tag in viewing.tags ?? []" :key="tag" color="primary" variant="soft" size="sm">{{ tag }}</UBadge>
          <span v-if="viewing.dueDate" class="text-xs text-default/60">
            Due {{ new Date(viewing.dueDate).toLocaleString() }}
          </span>
        </div>
        <MarkdownView
          :source="viewing.description || '_No description_'"
          class="max-h-96 overflow-y-auto rounded-lg border border-default bg-default p-3 text-sm"
        />
      </div>
      <!-- #footer, not #actions: actions render in the header next to the title. -->
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" @click="viewing = null">Close</UButton>
          <UButton color="primary" size="sm" @click="editViewing">Edit</UButton>
        </div>
      </template>
    </BaseModal>

    <BaseModal :open="!!deleting.length" title="Delete tasks" box-class="max-w-sm w-full" @close="deleting = []">
      <p class="text-sm text-muted">
        Delete
        {{ deleting.length === 1 ? `“${deleting[0]?.title}”` : `${deleting.length} tasks` }}? This can’t be undone.
      </p>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :disabled="deleteBusy" @click="deleting = []">Cancel</UButton>
          <UButton color="error" size="sm" :loading="deleteBusy" @click="confirmDelete">Delete</UButton>
        </div>
      </template>
    </BaseModal>
  </PageShell>
</template>
