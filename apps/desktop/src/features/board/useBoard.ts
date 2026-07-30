import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { Task, TaskStatus } from '@devdesk/shared'
import { BOARD_COLUMNS } from '@devdesk/shared'
import { getActiveWorkspaceId } from '@devdesk/database'
import { services } from '@/services'
import { bus } from '@/lib/events'

/** Loads a workspace's tasks and keeps them fresh by listening for task mutations. */
export function useBoard(workspaceId = getActiveWorkspaceId()) {
  const tasks = ref<Task[]>([])
  const search = ref('')
  const priority = ref<string>('') // '' = all
  const loading = ref(true)
  const error = ref('')

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

  let off: (() => void) | undefined
  onMounted(() => {
    void reload()
    off = bus.on('entity:mutated', (e) => e.kind === 'task' && reload())
  })
  onUnmounted(() => off?.())

  /**
   * Persist a column after a drag: write each task's status + position by its new index.
   * ponytail: rewrites the whole column (O(n) puts) rather than diffing — columns are
   * small; switch to a diff if a column ever holds hundreds of tasks.
   */
  async function persistColumn(status: TaskStatus, ordered: Task[]) {
    try {
      error.value = ''
      await Promise.all(ordered.map((t, i) => services.tasks.move(t.id, status, i)))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await reload()
      error.value = message
    }
  }

  /** Complete / re-open a task in place. Done tasks land back in 'todo'. */
  async function toggleDone(task: Task) {
    try {
      error.value = ''
      await services.tasks.update(task.id, { status: task.status === 'done' ? 'todo' : 'done' } as never)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  return { tasks, columns, search, priority, loading, error, reload, persistColumn, toggleDone }
}
