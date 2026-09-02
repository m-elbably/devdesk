import { ref } from 'vue'
import { setActiveWorkspaceId } from '@devdesk/database'
import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'
import type { Workspace, WorkspaceHome } from '@devdesk/shared'
import { services } from './index'

const KEY = 'devdesk.workspaceId'

export const activeWorkspaceId = ref(localStorage.getItem(KEY) ?? DEFAULT_WORKSPACE_ID)
export const workspaces = ref<Workspace[]>([])

// Apply before anything reads or writes records, so repositories scope correctly
// from the very first query.
setActiveWorkspaceId(activeWorkspaceId.value)

export const activeWorkspace = () => workspaces.value.find((w) => w.id === activeWorkspaceId.value)

export async function reloadWorkspaces(): Promise<void> {
  workspaces.value = await services.workspaces.list()
  if (activeWorkspace()) return
  // The stored id can point at a workspace that was deleted, belongs to another
  // device's data, or is the pre-uuid default id — fall back to the real default row
  // rather than showing an empty app. Resolved from the list, since the seeded id is
  // only a guess about what this install actually holds.
  const fallback = workspaces.value.find((w) => w.isDefault) ?? workspaces.value[0]
  if (fallback) selectWorkspace(fallback.id)
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const ws = await services.workspaces.create({ name } as never)
  await reloadWorkspaces()
  return ws
}

/** Deletes the workspace and everything scoped to it. If it was the active one,
 *  reloadWorkspaces falls back to the default and reloads, the same way switching does. */
export async function deleteWorkspace(id: string): Promise<void> {
  await services.workspaces.remove(id)
  await reloadWorkspaces()
}

/** Updates the small synced configuration that powers the active workspace home. */
export async function updateWorkspaceHome(home: WorkspaceHome): Promise<void> {
  const workspace = activeWorkspace()
  if (!workspace) return
  await services.workspaces.update(workspace.id, { home } as never)
  await reloadWorkspaces()
}

/**
 * ponytail: reload the window instead of invalidating every query, composable and
 * cached list. Switching workspaces is rare and a reload is unconditionally correct.
 */
export function selectWorkspace(id: string, reload = true): void {
  localStorage.setItem(KEY, id)
  activeWorkspaceId.value = id
  setActiveWorkspaceId(id)
  if (reload) {
    // Timestamp, not a flag: index.html paints the spinner, main.ts keeps it up
    // until a second has passed so a fast reload doesn't just flash.
    sessionStorage.setItem('devdesk.switching', String(Date.now()))
    window.location.reload()
  }
}
