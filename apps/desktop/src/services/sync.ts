import { computed, ref } from 'vue'
import { db, createRepositories } from '@devdesk/database'
import { ApiClient, SyncEngine, type AuthUser, type SyncStore } from '@devdesk/sync'
import type { EntityKind, SyncedRecord, SyncOperation } from '@devdesk/shared'
import { newId, nowIso, debounce } from '@devdesk/utils'
import { bus } from '@/lib/events'
import { migrateLegacySnippets } from '@/lib/snippetMigration'

const DEFAULT_URL = (import.meta.env.VITE_SYNC_API_URL as string) || 'http://localhost:8787'
const TOKEN_KEY = 'devdesk.sync.token'
const CURSOR_KEY = 'devdesk.sync.cursor'
const URL_KEY = 'devdesk.sync.url'

const repos = createRepositories()
const repoByKind = {
  workspace: repos.workspaces,
  task: repos.tasks,
  note: repos.notes,
  notebook: repos.notebooks,
  snippet: repos.snippets,
  setting: repos.settings,
} as const

const tableByKind = {
  workspace: db.workspaces,
  task: db.tasks,
  note: db.notes,
  notebook: db.notebooks,
  snippet: db.snippets,
  setting: db.settings,
} as const

// When applying server changes we re-emit 'entity:mutated' so the UI refreshes —
// this flag stops that emission from re-queuing the record we just pulled.
let suppressEnqueue = false

const store: SyncStore = {
  getPendingOps: () => db.syncQueue.toArray(),
  removePendingOps: (ids) => db.syncQueue.bulkDelete(ids),
  async applyRemote(kind, record) {
    suppressEnqueue = true
    try {
      await repoByKind[kind].applyRemote(record as never)
      bus.emit('entity:mutated', { kind, id: String(record.id), op: 'upsert' })
    } finally {
      suppressEnqueue = false
    }
  },
  getCursor: async () => localStorage.getItem(CURSOR_KEY) ?? '',
  setCursor: async (c) => localStorage.setItem(CURSOR_KEY, c),
}

/**
 * https is required so credentials never cross the wire in the clear; plain http is
 * allowed only for loopback, which is how the local `wrangler dev` server is reached.
 * Returns the origin plus any path prefix (ApiClient appends `/api/...` to it).
 */
export function normalizeServerUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a full URL, e.g. https://sync.example.com')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('Server URL must use https:// (http:// is allowed for localhost only)')
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}

export const serverUrl = ref(localStorage.getItem(URL_KEY) ?? DEFAULT_URL)

const api = new ApiClient(serverUrl.value)
const engine = new SyncEngine(store, api)

/** Point at a different sync server. Throws on an invalid/non-https URL. */
export function setServerUrl(input: string): void {
  const url = normalizeServerUrl(input)
  if (url === serverUrl.value) return
  logout() // the token and cursor belong to the old server
  localStorage.setItem(URL_KEY, url)
  serverUrl.value = url
  api.baseUrl = url
}

export type SyncStatus = 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'
export const syncStatus = ref<SyncStatus>('signed-out')
export const syncUser = ref<AuthUser | null>(null)
export const lastError = ref('')

/** Gates the Administration section. The server re-checks on every admin request. */
export const isAdmin = computed(() => syncUser.value?.role === 'admin')

/** The admin API, already carrying the signed-in user's token. */
export const adminApi = api

api.setToken(localStorage.getItem(TOKEN_KEY))

function makeOp(kind: EntityKind, record: SyncedRecord): SyncOperation {
  return {
    id: newId(),
    kind,
    entityId: record.id,
    op: record.deletedAt ? 'delete' : 'upsert',
    payload: record as unknown as Record<string, unknown>,
    createdAt: nowIso(),
    attempts: 0,
  }
}

/** Queue a local mutation for the next push (skips records we just pulled). */
async function enqueue(kind: EntityKind, id: string) {
  if (suppressEnqueue) return
  const record = await repoByKind[kind].getWithDeleted(id)
  if (!record) return
  await db.syncQueue.add(makeOp(kind, record))
  triggerSync()
}

/**
 * Records that already existed before this device first synced have no queue entry, so
 * without this a first sync would only ever pull and the local-only data would never
 * reach the server. An empty cursor means "never synced with this server/user", so queue
 * everything local once — the server merges last-write-wins, making a record it already
 * has a no-op.
 */
export async function backfillQueue(): Promise<void> {
  if (localStorage.getItem(CURSOR_KEY)) return
  const queued = new Set((await db.syncQueue.toArray()).map((o) => o.entityId))
  const ops: SyncOperation[] = []
  for (const [kind, table] of Object.entries(tableByKind)) {
    for (const record of await table.toArray()) {
      if (!queued.has(record.id)) ops.push(makeOp(kind as EntityKind, record))
    }
  }
  if (ops.length) await db.syncQueue.bulkAdd(ops)
}

const triggerSync = debounce(() => void syncNow(), 800)

export async function syncNow(): Promise<void> {
  if (!syncUser.value) return
  if (!navigator.onLine) {
    syncStatus.value = 'offline'
    return
  }
  syncStatus.value = 'syncing'
  try {
    await backfillQueue()
    await engine.sync()
    // A legacy client may still create a snippet. Convert after pull so we always
    // start from the server-authoritative copy, then sync the note+tombstone pair.
    if (await migrateLegacySnippets()) await engine.sync()
    syncStatus.value = 'idle'
  } catch (e) {
    lastError.value = e instanceof Error ? e.message : String(e)
    syncStatus.value = 'error'
  }
}

export async function login(email: string, password: string): Promise<void> {
  const { token, user } = await api.login(email, password)
  localStorage.setItem(TOKEN_KEY, token)
  api.setToken(token)
  syncUser.value = user
  syncStatus.value = 'idle'
  await syncNow()
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(CURSOR_KEY)
  api.setToken(null)
  syncUser.value = null
  syncStatus.value = 'signed-out'
}

/** Wire triggers: enqueue on every mutation, sync on reconnect + on a slow timer. */
export function startSync(): void {
  bus.on('entity:mutated', (e) => void enqueue(e.kind, e.id))
  window.addEventListener('online', () => void syncNow())

  // Restore an existing session and do an initial sync.
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    api
      .me()
      .then((r) => {
        syncUser.value = r.user
        syncStatus.value = 'idle'
        void syncNow()
      })
      .catch(() => logout())
  }

  setInterval(() => void syncNow(), 60_000) // periodic background pull
}
