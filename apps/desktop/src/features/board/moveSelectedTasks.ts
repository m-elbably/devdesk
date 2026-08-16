import type { Task, TaskStatus } from '@devdesk/shared'

type Column = { status: TaskStatus; tasks: Task[] }

/** Move a selected batch after Sortable has placed the task the user grabbed. */
export function moveSelectedTasks(columns: Column[], selected: Task[], targetStatus: TaskStatus, droppedAt: number): TaskStatus[] {
  const target = columns.find((column) => column.status === targetStatus)
  if (!target) return []
  const ids = new Set(selected.map((task) => task.id))
  const removedBeforeDrop = target.tasks.slice(0, droppedAt).filter((task) => ids.has(task.id)).length
  const affected = new Set<TaskStatus>()
  for (const column of columns) {
    if (column.tasks.some((task) => ids.has(task.id))) affected.add(column.status)
    column.tasks = column.tasks.filter((task) => !ids.has(task.id))
  }
  target.tasks.splice(Math.max(0, droppedAt - removedBeforeDrop), 0, ...selected)
  return [...affected]
}
