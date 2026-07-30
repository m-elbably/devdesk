import { DEFAULT_WORKSPACE_ID } from '@devdesk/shared'

// Which workspace new records belong to and which one plain `list()` reads from.
// A module-level value rather than a parameter threaded through every call site:
// there is exactly one active workspace per running app.
let active = DEFAULT_WORKSPACE_ID

export const getActiveWorkspaceId = (): string => active

export const setActiveWorkspaceId = (id: string): void => {
  active = id
}
