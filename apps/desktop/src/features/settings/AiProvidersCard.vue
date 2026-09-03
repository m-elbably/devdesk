<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErrorState } from '@devdesk/ui'
import { localityOf, PROVIDER_PRESETS, type ProviderConfig, type ProviderKind } from '@devdesk/ai'
import {
  activeProvider,
  activeProviderId,
  isConfigured,
  listModels,
  loadProviders,
  models,
  newProvider,
  presetOptions,
  providers,
  removeProvider,
  saveProvider,
  setActiveProvider,
  setToolCap,
  testConnection,
  toolCap,
} from '@/services/ai'
import { bus } from '@/lib/events'

const editing = ref<ProviderConfig | null>(null)
const testing = ref(false)
const error = ref('')

const TRANSPORTS = [
  { label: 'Automatic', value: 'auto' },
  { label: 'Browser fetch', value: 'fetch' },
  { label: 'Native (no streaming)', value: 'native' },
]

const addOptions = computed(() =>
  presetOptions.map((preset) => ({
    label: preset.label,
    onSelect: () => startAdd(preset.kind),
  })),
)

/** Local or cloud, shown wherever a provider is — the user should never have to guess. */
const localityOfConfig = (config: ProviderConfig) => localityOf(config.baseUrl)

const editingLocality = computed(() => (editing.value ? localityOfConfig(editing.value) : 'remote'))

onMounted(loadProviders)

function startAdd(kind: ProviderKind) {
  error.value = ''
  editing.value = newProvider(kind)
}

function startEdit(config: ProviderConfig) {
  error.value = ''
  editing.value = { ...config }
}

async function save() {
  if (!editing.value) return
  try {
    await saveProvider(editing.value)
    editing.value = null
    bus.emit('toast', { type: 'success', message: 'Provider saved.' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the provider.'
  }
}

async function test() {
  if (!editing.value) return
  testing.value = true
  error.value = ''
  const result = await testConnection(editing.value)
  testing.value = false

  if (!result.ok) {
    error.value = result.error
    return
  }
  bus.emit('toast', { type: 'success', message: `Connected — ${result.models} model${result.models === 1 ? '' : 's'} available.` })
}

async function refreshModels() {
  if (!editing.value) return
  try {
    await listModels(editing.value)
  } catch {
    /* listModels already recorded the reason; the panel shows it below */
  }
}

async function remove(config: ProviderConfig) {
  await removeProvider(config.id)
  if (editing.value?.id === config.id) editing.value = null
  bus.emit('toast', { type: 'success', message: `${config.label} removed.` })
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
          <h2 class="text-base font-semibold">AI assistant</h2>
        </div>
        <UDropdownMenu :items="addOptions">
          <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-plus">Add provider</UButton>
        </UDropdownMenu>
      </div>
    </template>

    <div class="divide-y divide-default">
      <div v-if="!isConfigured" class="pb-4">
        <p class="text-sm text-muted">
          No provider yet. DevDesk works with a model running on your own machine — LM Studio or Ollama, detected
          automatically when the assistant first opens — or with a cloud provider once you add an API key.
        </p>
        <p class="mt-2 text-sm text-muted">
          A local model gets the whole toolbox. A cloud provider is only ever offered the tools that cannot leak a
          secret.
        </p>
      </div>

      <div v-for="config in providers" :key="config.id" class="flex items-center justify-between gap-4 py-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium truncate">{{ config.label }}</p>
            <UBadge
              :color="localityOfConfig(config) === 'local' ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            >
              {{ localityOfConfig(config) === 'local' ? 'Local' : 'Cloud' }}
            </UBadge>
            <UBadge v-if="config.id === activeProviderId" color="primary" variant="subtle" size="sm">Active</UBadge>
          </div>
          <p class="text-sm text-muted truncate">
            {{ config.baseUrl || PROVIDER_PRESETS[config.kind].baseUrl }}
            <template v-if="config.model"> · {{ config.model }}</template>
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <UButton
            v-if="config.id !== activeProviderId"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="setActiveProvider(config.id)"
          >
            Use
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="startEdit(config)" />
          <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" @click="remove(config)" />
        </div>
      </div>

      <form v-if="editing" class="space-y-3 py-4" @submit.prevent="save">
        <div class="flex flex-wrap items-end gap-2">
          <UFormField label="Name" class="flex-1 min-w-40">
            <UInput v-model="editing.label" size="sm" class="w-full" required />
          </UFormField>
          <UFormField label="Base URL" class="flex-1 min-w-64">
            <UInput
              v-model="editing.baseUrl"
              size="sm"
              class="w-full"
              :placeholder="PROVIDER_PRESETS[editing.kind].baseUrl || 'http://localhost:8080/v1'"
            />
          </UFormField>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <UFormField
            v-if="PROVIDER_PRESETS[editing.kind].needsKey || editingLocality === 'remote'"
            label="API key"
            class="flex-1 min-w-64"
          >
            <UInput v-model="editing.apiKey" type="password" size="sm" class="w-full" placeholder="sk-…" />
          </UFormField>
          <UFormField label="Model" class="flex-1 min-w-48">
            <UInputMenu
              v-if="models.length"
              v-model="editing.model"
              :items="models.map((m) => m.id)"
              size="sm"
              class="w-full"
            />
            <UInput v-else v-model="editing.model" size="sm" class="w-full" placeholder="qwen2.5-coder" />
          </UFormField>
          <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-refresh-cw" @click="refreshModels">
            Load models
          </UButton>
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <UFormField label="Transport" class="w-56">
            <USelect v-model="editing.transport" :items="TRANSPORTS" size="sm" class="w-full" />
          </UFormField>
          <UCheckbox v-model="editing.redact" label="Strip secrets from outbound text" />
        </div>

        <p class="text-xs text-muted">
          <template v-if="editingLocality === 'local'">
            Local provider. Nothing leaves this machine, so the assistant is offered every tool.
          </template>
          <template v-else>
            Cloud provider. Only tools marked <code>PUBLIC</code> are offered to it; tools that handle secrets are
            withheld.
          </template>
          <template v-if="PROVIDER_PRESETS[editing.kind].hint">
            {{ PROVIDER_PRESETS[editing.kind].hint }}
          </template>
        </p>

        <div class="flex gap-2">
          <UButton type="submit" color="primary" size="sm">Save</UButton>
          <UButton color="neutral" variant="subtle" size="sm" :loading="testing" @click="test">
            Test connection
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="editing = null">Cancel</UButton>
        </div>

        <ErrorState v-if="error" :message="error" />
      </form>

      <div class="flex items-center justify-between gap-4 pt-4">
        <div>
          <p class="font-medium">Tools per message</p>
          <p class="text-sm text-muted">
            How many tool definitions the model is shown at once. Lower this for a small local model with a tight
            context window; raise it if the assistant misses tools it should have found.
          </p>
        </div>
        <UInput
          :model-value="toolCap"
          type="number"
          min="1"
          max="60"
          size="sm"
          class="w-24 shrink-0"
          @update:model-value="setToolCap(Number($event))"
        />
      </div>

      <p v-if="activeProvider" class="pt-4 text-sm text-muted">
        API keys are stored on this device only. They are never synced, and they are stripped from database backups.
      </p>
    </div>
  </UCard>
</template>
