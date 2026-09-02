<script setup lang="ts">
import { ref, watch } from 'vue'
import PageShell from '@/components/PageShell.vue'
import ThemeSwitcher from '@/components/ThemeSwitcher.vue'
import { ErrorState } from '@devdesk/ui'
import { syncUser, syncStatus, login, logout, syncNow, serverUrl, setServerUrl } from '@/services/sync'
import { desktop } from '@/services/desktop'
import { exportBackup, exportWorkspaceMarkdown, importBackup } from '@devdesk/database'
import { activeWorkspace, activeWorkspaceId, workspaces, createWorkspace, deleteWorkspace, WORKSPACE_TEMPLATES, type WorkspaceTemplate } from '@/services/workspace'
import type { Workspace } from '@devdesk/shared'
import { bus } from '@/lib/events'
import { services } from '@/services'

const AUTOSAVE_OPTIONS = [
  { label: 'Off', value: '0' },
  { label: 'Every minute', value: '60000' },
  { label: 'Every 5 minutes', value: '300000' },
  { label: 'Every 10 minutes', value: '600000' },
]

// Every handler accepts either modifier (ctrlKey || metaKey), so label the one
// the user's keyboard actually has instead of always showing ⌘.
const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'
const SHORTCUTS = [
  { keys: [MOD, 'K'], label: 'Open command palette' },
  { keys: [MOD, 'W'], label: 'Switch workspace' },
  { keys: [MOD, 'S'], label: 'Save note or snippet' },
  { keys: ['Esc'], label: 'Close dialog or menu' },
]

const SYNC_BADGE = {
  'signed-out': { color: 'neutral', label: 'Signed out' },
  idle: { color: 'success', label: 'Synced' },
  syncing: { color: 'info', label: 'Syncing…' },
  offline: { color: 'warning', label: 'Offline' },
  error: { color: 'error', label: 'Sync error' },
} as const

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const shortcutsOpen = ref(false)

// Notes autosave interval (ms; 0 = off). Read/write localStorage directly, matching
// ThemeSwitcher's pattern. NotesPage reads this on mount.
const autosaveMs = ref(localStorage.getItem('devdesk.autosaveMs') ?? '300000')
watch(autosaveMs, (v) => localStorage.setItem('devdesk.autosaveMs', v))

const backingUp = ref(false)
async function backupDb() {
  backingUp.value = true
  try {
    const json = await exportBackup()
    await desktop.saveTextFile(`devdesk-backup-${new Date().toISOString().slice(0, 10)}.json`, json)
    bus.emit('toast', { type: 'success', message: 'Database backed up.' })
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Backup failed.' })
  } finally {
    backingUp.value = false
  }
}

const exportingMarkdown = ref(false)
async function exportMarkdown() {
  const workspace = activeWorkspace()
  if (!workspace) return
  exportingMarkdown.value = true
  try {
    const [tasks, notes, snippets] = await Promise.all([services.tasks.list(), services.notes.list(), services.snippets.list()])
    const safeName = workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace'
    await desktop.saveTextFile(`${safeName}.md`, exportWorkspaceMarkdown(workspace, tasks, notes, snippets))
    bus.emit('toast', { type: 'success', message: 'Workspace exported as Markdown.' })
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Markdown export failed.' })
  } finally {
    exportingMarkdown.value = false
  }
}

const importingDb = ref(false)
async function importDb() {
  importingDb.value = true
  try {
    const json = await desktop.openTextFile()
    if (!json) return
    await importBackup(json)
    bus.emit('toast', { type: 'success', message: 'Database imported. Reloading…' })
    setTimeout(() => window.location.reload(), 800)
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Import failed.' })
  } finally {
    importingDb.value = false
  }
}

const newWorkspaceOpen = ref(false)
const newWorkspace = ref('')
const workspaceTemplate = ref<WorkspaceTemplate>('empty')
const addingWorkspace = ref(false)
async function addWorkspace() {
  const name = newWorkspace.value.trim()
  if (!name) return
  addingWorkspace.value = true
  try {
    const ws = await createWorkspace(name, workspaceTemplate.value)
    newWorkspace.value = ''
    workspaceTemplate.value = 'empty'
    newWorkspaceOpen.value = false
    bus.emit('toast', { type: 'success', message: `Workspace “${ws.name}” created.` })
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Could not create workspace.' })
  } finally {
    addingWorkspace.value = false
  }
}

const workspaceToDelete = ref<Workspace | null>(null)
const deletingWorkspace = ref(false)
async function confirmDeleteWorkspace() {
  const ws = workspaceToDelete.value
  if (!ws) return
  deletingWorkspace.value = true
  try {
    await deleteWorkspace(ws.id)
    workspaceToDelete.value = null
    bus.emit('toast', { type: 'success', message: `Workspace “${ws.name}” deleted.` })
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Could not delete workspace.' })
  } finally {
    deletingWorkspace.value = false
  }
}

const serverUrlInput = ref(serverUrl.value)
const serverUrlError = ref('')
function saveServerUrl() {
  serverUrlError.value = ''
  try {
    setServerUrl(serverUrlInput.value)
    serverUrlInput.value = serverUrl.value
    bus.emit('toast', { type: 'success', message: 'Sync server updated. Sign in again.' })
  } catch (e) {
    serverUrlError.value = e instanceof Error ? e.message : 'Invalid URL'
  }
}

async function signIn() {
  error.value = ''
  busy.value = true
  try {
    await login(email.value, password.value)
    password.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PageShell title="Settings" subtitle="Application preferences">
    <div class="space-y-6 max-w-3xl">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-palette" class="size-4 text-primary" />
            <h2 class="text-base font-semibold">Appearance</h2>
          </div>
        </template>
        <div class="divide-y divide-default">
          <div class="flex items-center justify-between gap-4 pb-4">
            <div>
              <p class="font-medium">Theme</p>
              <p class="text-sm text-muted">Light, dark, or follow the system setting.</p>
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-layout-panel-left" class="size-4 text-primary" />
              <h2 class="text-base font-semibold">Workspaces</h2>
            </div>
            <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-plus" @click="newWorkspaceOpen = true">
              New workspace
            </UButton>
          </div>
        </template>
        <div class="overflow-hidden rounded-lg border border-default">
          <table class="w-full text-sm">
            <thead class="bg-elevated text-left text-xs font-semibold uppercase tracking-wider text-dimmed">
              <tr>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2 w-24">Active</th>
                <th class="px-3 py-2 w-16"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="w in workspaces" :key="w.id">
                <td class="px-3 py-2 truncate">{{ w.name }}</td>
                <td class="px-3 py-2">
                  <UBadge v-if="w.id === activeWorkspaceId" color="primary" variant="subtle" size="sm">Active</UBadge>
                </td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-trash-2"
                    :disabled="workspaces.length <= 1"
                    :title="workspaces.length <= 1 ? 'At least one workspace is required' : 'Delete workspace'"
                    @click="workspaceToDelete = w"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-database" class="size-4 text-primary" />
            <h2 class="text-base font-semibold">Data</h2>
          </div>
        </template>
        <div class="divide-y divide-default">
          <div class="flex items-center justify-between gap-4 pb-4">
            <div>
              <p class="font-medium">Notes autosave</p>
              <p class="text-sm text-muted">How often notes and snippets save while you type.</p>
            </div>
            <USelect v-model="autosaveMs" size="sm" :items="AUTOSAVE_OPTIONS" class="w-44 shrink-0" />
          </div>
          <div class="flex items-center justify-between gap-4 py-4">
            <div>
              <p class="font-medium">Backup database</p>
              <p class="text-sm text-muted">Save all workspaces, tasks, notes and snippets to a JSON file.</p>
            </div>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-hard-drive-download"
              :loading="backingUp"
              @click="backupDb"
            >
              Export to file
            </UButton>
          </div>
          <div class="flex items-center justify-between gap-4 py-4">
            <div>
              <p class="font-medium">Export workspace as Markdown</p>
              <p class="text-sm text-muted">Save the active workspace as one readable Markdown file.</p>
            </div>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-file-text"
              :loading="exportingMarkdown"
              @click="exportMarkdown"
            >
              Export Markdown
            </UButton>
          </div>
          <div class="flex items-center justify-between gap-4 pt-4">
            <div>
              <p class="font-medium">Restore database</p>
              <p class="text-sm text-muted">Import a backup file. Matching items are overwritten.</p>
            </div>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-hard-drive-upload"
              :loading="importingDb"
              @click="importDb"
            >
              Import from file
            </UButton>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-refresh-cw" class="size-4 text-primary" />
              <h2 class="text-base font-semibold">Cloud sync</h2>
            </div>
            <UBadge :color="SYNC_BADGE[syncStatus].color" variant="subtle" size="sm">
              {{ SYNC_BADGE[syncStatus].label }}
            </UBadge>
          </div>
        </template>
        <div class="divide-y divide-default">
          <div class="flex items-center justify-between gap-4 pb-4">
            <div>
              <p class="font-medium">Account</p>
              <p class="text-sm text-muted">
                <template v-if="syncUser">Signed in as <strong class="text-default">{{ syncUser.email }}</strong></template>
                <template v-else>Optional. Everything works offline — sign in only to sync across devices.</template>
              </p>
            </div>
            <div v-if="syncUser" class="flex gap-2 shrink-0">
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-refresh-cw"
                :loading="syncStatus === 'syncing'"
                @click="syncNow"
              >
                Sync now
              </UButton>
              <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout">
                Sign out
              </UButton>
            </div>
          </div>

          <form v-if="!syncUser" class="flex flex-wrap items-end gap-2 py-4" @submit.prevent="signIn">
            <UFormField label="Email" class="flex-1 min-w-48">
              <UInput v-model="email" type="email" class="w-full" placeholder="you@example.com" required />
            </UFormField>
            <UFormField label="Password" class="flex-1 min-w-48">
              <UInput v-model="password" type="password" class="w-full" placeholder="min 8 characters" required />
            </UFormField>
            <UButton type="submit" color="primary" size="sm" :loading="busy">
              {{ busy ? 'Signing in…' : 'Sign in' }}
            </UButton>
            <ErrorState v-if="error" :message="error" class="w-full" />
          </form>

          <form class="flex items-center justify-between gap-4 pt-4" @submit.prevent="saveServerUrl">
            <div>
              <p class="font-medium">Server URL</p>
              <p class="text-sm text-muted">https only (http for localhost). Changing it requires signing in again.</p>
            </div>
            <div class="flex gap-2 shrink-0">
              <UInput v-model="serverUrlInput" size="sm" class="w-56" placeholder="https://sync.example.com" required />
              <UButton
                type="submit"
                color="neutral"
                variant="subtle"
                size="sm"
                :disabled="serverUrlInput.trim() === serverUrl"
              >
                Save
              </UButton>
            </div>
          </form>
          <ErrorState v-if="serverUrlError" :message="serverUrlError" class="pt-2" />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-keyboard" class="size-4 text-primary" />
              <h2 class="text-base font-semibold">Keyboard shortcuts</h2>
            </div>
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-keyboard" @click="shortcutsOpen = true">
              View shortcuts
            </UButton>
          </div>
        </template>
        <p class="text-sm text-muted">See the available keyboard shortcuts for navigating and editing.</p>
      </UCard>

      <UCard>
        <div class="flex items-center justify-between gap-4 text-sm text-muted">
          <p>Built by <span class="text-default">Mohamed El-Bably</span></p>
          <div class="flex gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-linkedin"
              @click="desktop.openExternal('https://www.linkedin.com/in/mohamed-el-bably-8239249/')"
            >
              LinkedIn
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-github"
              @click="desktop.openExternal('https://github.com/m-elbably')"
            >
              GitHub
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <!-- #body, not #content: #content replaces the whole panel, so the title,
         description and close button never render. -->
    <UModal v-model:open="shortcutsOpen" title="Keyboard shortcuts" description="Available shortcuts in DevDesk">
      <template #body>
        <div class="divide-y divide-default">
          <div v-for="s in SHORTCUTS" :key="s.label" class="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <span class="text-sm">{{ s.label }}</span>
            <span class="flex items-center gap-1">
              <UKbd v-for="k in s.keys" :key="k">{{ k }}</UKbd>
            </span>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="newWorkspaceOpen" title="New workspace" description="Choose an empty workspace or a small software-project starter.">
      <template #body>
        <form class="space-y-4" @submit.prevent="addWorkspace">
          <UFormField label="Name">
            <UInput v-model="newWorkspace" class="w-full" placeholder="Client project" required autofocus />
          </UFormField>
          <UFormField label="Template" :description="WORKSPACE_TEMPLATES[workspaceTemplate].description">
            <select v-model="workspaceTemplate" class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm">
              <option v-for="(template, id) in WORKSPACE_TEMPLATES" :key="id" :value="id">{{ template.label }}</option>
            </select>
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" size="sm" @click="newWorkspaceOpen = false">Cancel</UButton>
            <UButton type="submit" color="primary" size="sm" :loading="addingWorkspace">Add</UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!workspaceToDelete"
      title="Delete workspace"
      description="This can’t be undone."
      @update:open="(v) => !v && (workspaceToDelete = null)"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Delete “{{ workspaceToDelete?.name }}”? Its tasks, notes and snippets are deleted too.
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="sm" @click="workspaceToDelete = null">Cancel</UButton>
            <UButton color="error" size="sm" :loading="deletingWorkspace" @click="confirmDeleteWorkspace">Delete</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
