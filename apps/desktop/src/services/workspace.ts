import { ref } from 'vue'
import { setActiveWorkspaceId } from '@devdesk/database'
import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'
import type { Workspace, WorkspaceHome } from '@devdesk/shared'
import { services } from './index'

const KEY = 'devdesk.workspaceId'

export const WORKSPACE_TEMPLATES = {
  empty: { label: 'Empty', description: 'Start with a blank workspace.' },
  software: { label: 'Software project', description: 'Starter tasks, a project brief, and a README note.' },
  incident: { label: 'Incident response', description: 'An urgent response board, timeline, and status-update starter.' },
} as const
export type WorkspaceTemplate = keyof typeof WORKSPACE_TEMPLATES

export const activeWorkspaceId = ref(localStorage.getItem(KEY) ?? DEFAULT_WORKSPACE_ID)
export const workspaces = ref<Workspace[]>([])

// Apply before anything reads or writes records, so repositories scope correctly
// from the very first query.
setActiveWorkspaceId(activeWorkspaceId.value)

export const activeWorkspace = () => workspaces.value.find((w) => w.id === activeWorkspaceId.value)

export async function reloadWorkspaces(): Promise<void> {
  // Rows written before `home` existed come back without it; default here so no
  // caller has to guard `workspace.home`.
  workspaces.value = (await services.workspaces.list()).map((w) => ({ ...w, home: w.home ?? { toolIds: [], noteIds: [], snippetIds: [] } }))
  if (activeWorkspace()) return
  // The stored id can point at a workspace that was deleted, belongs to another
  // device's data, or is the pre-uuid default id — fall back to the real default row
  // rather than showing an empty app. Resolved from the list, since the seeded id is
  // only a guess about what this install actually holds.
  const fallback = workspaces.value.find((w) => w.isDefault) ?? workspaces.value[0]
  if (fallback) selectWorkspace(fallback.id)
}

export async function createWorkspace(name: string, template: WorkspaceTemplate = 'empty'): Promise<Workspace> {
  const ws = await services.workspaces.create({ name } as never)
  if (template === 'software') {
    await Promise.all([
      services.tasks.create({ workspaceId: ws.id, title: 'Define the first outcome', status: 'backlog', position: 0 } as never),
      services.tasks.create({ workspaceId: ws.id, title: 'Set up the project', status: 'todo', position: 0 } as never),
      services.tasks.create({ workspaceId: ws.id, title: 'Ship the first deliverable', status: 'todo', position: 1 } as never),
      services.notes.create({ workspaceId: ws.id, title: 'Project brief', body: '# Project brief\n\n## Goal\n\n## Constraints\n\n## Next milestone\n', tags: [] } as never),
      services.notes.create({ workspaceId: ws.id, title: 'README starter', body: '# Project name\n\n## Development\n\n## Decisions\n', tags: [] } as never),
    ])
  }
  if (template === 'incident') {
    await Promise.all([
      services.tasks.create({ workspaceId: ws.id, title: 'Assess impact and scope', status: 'in_progress', priority: 'urgent', position: 0 } as never),
      services.tasks.create({ workspaceId: ws.id, title: 'Mitigate the incident', status: 'todo', priority: 'urgent', position: 0 } as never),
      services.tasks.create({ workspaceId: ws.id, title: 'Publish a status update', status: 'todo', priority: 'high', position: 1 } as never),
      services.tasks.create({ workspaceId: ws.id, title: 'Document follow-up actions', status: 'backlog', priority: 'high', position: 0 } as never),
      services.notes.create({ workspaceId: ws.id, title: 'Incident timeline', body: '# Incident timeline\n\n## Detection\n\n## Impact\n\n## Actions\n\n## Resolution\n', tags: ['incident'] } as never),
      services.notes.create({ workspaceId: ws.id, title: 'Status update', body: '## Status update\n\n**Impact:** \n\n**Current action:** \n\n**Next update:** \n', tags: ['incident'] } as never),
    ])
  }
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
  // `home` is assembled from reactive arrays; IndexedDB cannot clone Vue proxies.
  await services.workspaces.update(workspace.id, { home: JSON.parse(JSON.stringify(home)) } as never)
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
