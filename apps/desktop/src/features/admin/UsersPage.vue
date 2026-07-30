<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Users } from 'lucide-vue-next'
import type { AuthUser } from '@devdesk/sync'
import { EmptyState, ErrorState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import { adminApi, isAdmin, syncUser } from '@/services/sync'
import { bus } from '@/lib/events'

const users = ref<AuthUser[]>([])
const loading = ref(true)
const error = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  try {
    users.value = (await adminApi.listUsers()).users
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => void reload())

// One dialog driving three actions — they differ only in which fields show and
// which request fires, so three near-identical modals would be pure duplication.
type Mode = 'create' | 'rename' | 'password'
const mode = ref<Mode>('create')
const target = ref<AuthUser | null>(null)
const form = ref({ email: '', name: '', password: '' })
const open = ref(false)
const saving = ref(false)
const formError = ref('')

const TITLES: Record<Mode, string> = {
  create: 'Add user',
  rename: 'Edit name',
  password: 'Reset password',
}

// Admins issue the password, but the user should never see one an admin
// picked — a fresh random string forces a real reset instead of "welcome1".
function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => chars[n % chars.length]).join('')
}

function openDialog(next: Mode, user?: AuthUser) {
  mode.value = next
  target.value = user ?? null
  form.value = { email: '', name: user?.name ?? '', password: next === 'rename' ? '' : randomPassword() }
  formError.value = ''
  open.value = true
}

async function copyPassword() {
  await navigator.clipboard.writeText(form.value.password)
  bus.emit('toast', { type: 'success', message: 'Password copied' })
}

async function submit() {
  saving.value = true
  formError.value = ''
  try {
    const { email, name, password } = form.value
    if (mode.value === 'create') await adminApi.createUser({ email, name, password })
    else if (mode.value === 'rename') await adminApi.renameUser(target.value!.id, name)
    else await adminApi.resetUserPassword(target.value!.id, password)
    open.value = false
    const suffix = mode.value === 'rename' ? '' : ` Password: ${password}`
    bus.emit('toast', { type: 'success', message: `${TITLES[mode.value]} — done.${suffix}` })
    await reload()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

const togglingId = ref<string | null>(null)

async function toggleActive(user: AuthUser) {
  togglingId.value = user.id
  try {
    await adminApi.setUserActive(user.id, !user.active)
    bus.emit('toast', { type: 'success', message: user.active ? 'User disabled.' : 'User enabled.' })
    await reload()
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <PageShell title="Users" subtitle="Accounts that can sign in to this sync server" :icon="Users">
    <template #actions>
      <UButton color="primary" size="sm" icon="i-lucide-user-plus" :disabled="!isAdmin" @click="openDialog('create')">
        Add user
      </UButton>
    </template>

    <ErrorState v-if="!isAdmin" message="Sign in as an administrator to manage users." />

    <UCard v-else>
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 4" :key="i" class="flex items-center gap-4">
          <USkeleton class="h-4 w-40" />
          <USkeleton class="h-4 w-56" />
          <USkeleton class="h-4 w-16" />
          <USkeleton class="h-8 w-40 ml-auto" />
        </div>
      </div>

      <ErrorState v-else-if="error" :message="error" />

      <EmptyState v-else-if="!users.length" title="No users yet" description="Add the first account to get started." />

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left text-xs uppercase tracking-wider text-dimmed">
              <th class="px-2 py-2 font-semibold">Name</th>
              <th class="px-2 py-2 font-semibold">Email</th>
              <th class="px-2 py-2 font-semibold">Role</th>
              <th class="px-2 py-2 font-semibold">Status</th>
              <th class="px-2 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="u in users" :key="u.id">
              <td class="px-2 py-2.5 font-medium text-highlighted">
                {{ u.name || '—' }}
                <span v-if="u.id === syncUser?.id" class="text-xs text-dimmed">(you)</span>
              </td>
              <td class="px-2 py-2.5 text-muted">{{ u.email }}</td>
              <td class="px-2 py-2.5">
                <UBadge :color="u.role === 'admin' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                  {{ u.role }}
                </UBadge>
              </td>
              <td class="px-2 py-2.5">
                <UBadge :color="u.active ? 'success' : 'neutral'" variant="subtle" size="sm">
                  {{ u.active ? 'Active' : 'Disabled' }}
                </UBadge>
              </td>
              <td class="px-2 py-2.5">
                <div class="flex justify-end gap-1">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-pencil"
                    aria-label="Edit name"
                    title="Edit name"
                    @click="openDialog('rename', u)"
                  />
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-key-round"
                    aria-label="Reset password"
                    title="Reset password"
                    @click="openDialog('password', u)"
                  />
                  <UButton
                    :color="u.active ? 'error' : 'success'"
                    variant="ghost"
                    size="xs"
                    :icon="u.active ? 'i-lucide-ban' : 'i-lucide-circle-check'"
                    :aria-label="u.active ? 'Disable user' : 'Enable user'"
                    :title="u.role === 'admin' ? 'The administrator account cannot be disabled' : u.active ? 'Disable user' : 'Enable user'"
                    :disabled="u.role === 'admin' && u.active"
                    :loading="togglingId === u.id"
                    @click="toggleActive(u)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UModal v-model:open="open" :title="TITLES[mode]" :description="target?.email ?? 'Create a new account'">
      <template #content>
        <form class="space-y-4 p-4" @submit.prevent="submit">
          <p class="text-sm text-muted">
            {{ target ? target.email : 'The account is created with the “user” role.' }}
          </p>
          <UFormField v-if="mode === 'create'" label="Email">
            <UInput v-model="form.email" type="email" class="w-full" placeholder="dev@example.com" required />
          </UFormField>
          <UFormField v-if="mode !== 'password'" label="Name">
            <UInput v-model="form.name" class="w-full" placeholder="Jane Developer" required />
          </UFormField>
          <UFormField v-if="mode !== 'rename'" label="Password" hint="Randomly generated">
            <div class="flex gap-2">
              <UInput :model-value="form.password" readonly class="w-full font-mono" />
              <UButton color="neutral" variant="outline" icon="i-lucide-copy" aria-label="Copy password" @click="copyPassword" />
            </div>
          </UFormField>
          <ErrorState v-if="formError" :message="formError" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
            <UButton type="submit" color="primary" :loading="saving">Save</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </PageShell>
</template>
