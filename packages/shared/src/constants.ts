import type { TaskStatus } from './entities'

export const APP_NAME = 'DevDesk'

/**
 * The seeded workspace's id. A fixed uuid rather than a generated one: two fresh
 * devices on the same account both seed before their first sync, and a shared id is
 * what merges those into one "Personal" workspace instead of two.
 *
 * Installs seeded before this was a uuid keep their old id — `bootstrap` adopts any
 * existing default workspace, so nothing needs migrating.
 */
export const DEFAULT_WORKSPACE_ID = '8af5bc54-0430-4f54-9e78-cad939b3070d'

export const BOARD_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
]

export const RECENT_TOOLS_LIMIT = 12
export const TOOL_HISTORY_LIMIT = 200
