import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { Task, TaskStatus } from '@devdesk/shared'
import { BOARD_COLUMNS } from '@devdesk/shared'
import { getActiveWorkspaceId } from '@devdesk/database'
import { services } from '@/services'
import { bus } from '@/lib/events'
import type { ParsedTask } from './markdownTasks'

/** Loads a workspace's tasks and keeps them fresh by listening for task mutations. */
export function useBoard(workspaceId = getActiveWorkspaceId()) {
  const tasks = ref<Task[]>([])
  const search = ref('')
  const priority = ref<string>('') // '' = all
  const loading = ref(true)
  const error = ref('')
  const selectedIds = ref(new Set<string>())

  async function reload() {
    try {
      error.value = ''
      tasks.value = await services.tasks.byWorkspace(workspaceId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  const filtered = computed(() =>
    tasks.value.filter((t) => {
      if (priority.value && t.priority !== priority.value) return false
      if (!search.value) return true
      const q = search.value.toLowerCase()
      return t.title.toLowerCase().includes(q) || (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    }),
  )

  /** Tasks grouped into board columns, each sorted by position. */
  const columns = computed(() =>
    BOARD_COLUMNS.map((col) => ({
      ...col,
      tasks: filtered.value
        .filter((t) => t.status === col.status)
        .sort((a, b) => a.position - b.position),
    })),
  )

  /** Ids the user ticked, minus anything that has since disappeared from the board. */
  const selected = computed(() => tasks.value.filter((t) => selectedIds.value.has(t.id)))

  function toggleSelect(task: Task) {
    if (!selectedIds.value.delete(task.id)) selectedIds.value.add(task.id)
  }
  function clearSelection() {
    selectedIds.value.clear()
  }

  /** Select every task in a column, or clear them all if they're already selected. */
  function toggleMany(list: Task[]) {
    const allSelected = list.length > 0 && list.every((t) => selectedIds.value.has(t.id))
    for (const t of list) {
      if (allSelected) selectedIds.value.delete(t.id)
      else selectedIds.value.add(t.id)
    }
  }

  /** Tri-state for a column's select-all checkbox. */
  function selectionState(list: Task[]): boolean | 'indeterminate' {
    const count = list.filter((t) => selectedIds.value.has(t.id)).length
    if (!count) return false
    return count === list.length ? true : 'indeterminate'
  }

  // persistColumn fires one 'entity:mutated' per task it moves, so a single drag can
  // trigger a burst of reloads in quick succession — each one replaces `tasks.value`
  // wholesale, which tears down and rebuilds every column's DOM out from under
  // vuedraggable mid-drag and corrupts its next drag session. Local writes hold the
  // refresh until the final write finishes; external bursts stay debounced.
  let off: (() => void) | undefined
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  let localTaskWrites = 0
  let reloadQueued = false
  function scheduleReload() {
    if (localTaskWrites) {
      reloadQueued = true
      return
    }
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(reload, 150)
  }
  onMounted(() => {
    void reload()
    off = bus.on('entity:mutated', (e) => e.kind === 'task' && scheduleReload())
  })
  onUnmounted(() => {
    off?.()
    clearTimeout(reloadTimer)
  })

  /** Run a mutation, surfacing any failure in `error` instead of throwing at the caller. */
  async function guard(fn: () => Promise<unknown>) {
    try {
      error.value = ''
      await fn()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /**
   * Persist a column after a drag: write each task's status + position by its new index.
   * ponytail: rewrites the whole column (O(n) puts) rather than diffing — columns are
   * small; switch to a diff if a column ever holds hundreds of tasks.
   */
  async function persistColumn(status: TaskStatus, ordered: Task[]) {
    localTaskWrites++
    try {
      error.value = ''
      await Promise.all(ordered.map((t, i) => services.tasks.move(t.id, status, i)))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await reload()
      error.value = message
    } finally {
      localTaskWrites--
      if (!localTaskWrites && reloadQueued) {
        reloadQueued = false
        scheduleReload()
      }
    }
  }

  /** Swap a task with its neighbour in the same column (`delta` of -1 / +1). */
  async function moveBy(task: Task, delta: number) {
    const column = columns.value.find((c) => c.status === task.status)
    if (!column) return
    const from = column.tasks.findIndex((t) => t.id === task.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= column.tasks.length) return
    const ordered = [...column.tasks]
    const [moved] = ordered.splice(from, 1)
    if (!moved) return
    ordered.splice(to, 0, moved)
    await persistColumn(task.status, ordered)
  }

  /** Whether a task has a neighbour to swap with — drives the context menu's disabled state. */
  function canMove(task: Task, delta: number) {
    const column = columns.value.find((c) => c.status === task.status)
    const index = column?.tasks.findIndex((t) => t.id === task.id) ?? -1
    return index >= 0 && index + delta >= 0 && index + delta < (column?.tasks.length ?? 0)
  }

  /** Apply one patch to every given task. Used by the bulk-actions menu. */
  function updateMany(list: Task[], patch: Partial<Task>) {
    return guard(async () => {
      // A bulk column move has to append: without fresh positions the batch keeps
      // whatever index it held in its old column, so several tasks land on the same
      // position and the column's order becomes arbitrary.
      const moving = new Set(list.map((t) => t.id))
      let position = patch.status
        ? tasks.value.filter((t) => t.status === patch.status && !moving.has(t.id)).length
        : 0
      await Promise.all(
        list.map((t) =>
          services.tasks.update(t.id, (patch.status ? { ...patch, position: position++ } : patch) as never),
        ),
      )
      clearSelection()
    })
  }

  function removeMany(list: Task[]) {
    return guard(async () => {
      await Promise.all(list.map((t) => services.tasks.remove(t.id)))
      clearSelection()
    })
  }

  /**
   * Create tasks parsed from markdown, appending each to the end of its column.
   * ponytail: sequential creates, and every create re-triggers the bus reload — fine
   * for the list-sized imports this takes; batch the writes if it ever feels slow.
   */
  function importTasks(parsed: ParsedTask[]) {
    return guard(async () => {
      const next = Object.fromEntries(
        BOARD_COLUMNS.map(({ status }) => [status, tasks.value.filter((t) => t.status === status).length]),
      ) as Record<TaskStatus, number>
      for (const task of parsed) {
        await services.tasks.create({ ...task, dueDate: null, position: next[task.status]++ } as never)
      }
    })
  }

  return {
    tasks,
    columns,
    search,
    priority,
    loading,
    error,
    selected,
    selectedIds,
    reload,
    persistColumn,
    toggleSelect,
    clearSelection,
    toggleMany,
    selectionState,
    moveBy,
    canMove,
    updateMany,
    removeMany,
    importTasks,
  }
}
