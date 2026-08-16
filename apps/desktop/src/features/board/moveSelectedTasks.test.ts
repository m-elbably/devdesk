import { expect, it } from 'vitest'
import type { Task } from '@devdesk/shared'
import { moveSelectedTasks } from './moveSelectedTasks'

const task = (id: string) => ({ id }) as Task

it('moves every selected task to the drop position in selection order', () => {
  const first = task('first')
  const dragged = task('dragged')
  const columns = [
    { status: 'todo' as const, tasks: [first] },
    { status: 'done' as const, tasks: [task('before'), dragged, task('after')] },
  ]

  expect(moveSelectedTasks(columns, [first, dragged], 'done', 1)).toEqual(['todo', 'done'])
  expect(columns.map((column) => column.tasks.map((item) => item.id))).toEqual([[], ['before', 'first', 'dragged', 'after']])
})
