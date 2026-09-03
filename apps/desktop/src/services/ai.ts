import { computed, ref } from 'vue'
import { createRepositories, type AiProviderRow } from '@devdesk/database'
import {
  PRESET_ORDER,
  PROVIDER_PRESETS,
  configFromPreset,
  createModel,
  explainProviderError,
  listModels as listProviderModels,
  localityOf,
  type Locality,
  type ModelInfo,
  type ProviderConfig,
  type ProviderKind,
  type TransportOptions,
  type ToolUiHints,
} from '@devdesk/ai'
import { newId } from '@devdesk/utils'
import { TOOL_UI } from '@/tools/ui-spec'
import { redactText } from '@/lib/redactText'

const repos = createRepositories()

const ACTIVE_KEY = 'devdesk.ai.activeProvider'
const CAP_KEY = 'devdesk.ai.toolCap'

/** Local servers we probe once, so a first run needs no configuration at all. */
const AUTODETECT: ProviderKind[] = ['lmstudio', 'ollama']

export const providers = ref<ProviderConfig[]>([])
export const activeProviderId = ref<string>(localStorage.getItem(ACTIVE_KEY) ?? '')
export const models = ref<ModelInfo[]>([])
export const lastError = ref('')
/** True once a turn has fallen back to the native bridge, which cannot stream. */
export const usingNativeTransport = ref(false)

export type AiStatus = 'unconfigured' | 'idle' | 'testing' | 'streaming' | 'error'
export const status = ref<AiStatus>('unconfigured')

export const activeProvider = computed(
  () => providers.value.find((p) => p.id === activeProviderId.value) ?? providers.value[0],
)

/**
 * Where the active provider runs. Everything downstream of this — which tools the
 * model may see, whether outbound text is redacted, what the panel badge says —
 * follows from it, so it is derived from the URL and never stored.
 */
export const activeLocality = computed<Locality>(() =>
  activeProvider.value ? localityOf(activeProvider.value.baseUrl) : 'remote',
)

export const isConfigured = computed(() => providers.value.length > 0)

/** How many tool definitions to send per turn. Small local models need a small belt. */
export const toolCap = ref(Number(localStorage.getItem(CAP_KEY)) || 10)

export function setToolCap(value: number): void {
  const clamped = Math.max(1, Math.min(60, Math.round(value)))
  toolCap.value = clamped
  localStorage.setItem(CAP_KEY, String(clamped))
}

/**
 * Field labels and option lists from the tool UI specs, so the model is told what
 * each argument means rather than just its type.
 *
 * Passed to `@devdesk/ai` as plain data rather than imported there: the AI package
 * holds the same distance from the desktop app that `@devdesk/tools` does.
 */
export const uiHints: ToolUiHints = Object.fromEntries(
  Object.entries(TOOL_UI).map(([toolId, spec]) => [
    toolId,
    {
      fields: spec.fields.map((field) => ({
        kind: field.kind,
        name: field.name,
        label: field.label,
        ...('options' in field && field.options ? { options: field.options } : {}),
      })),
    },
  ]),
)

const toConfig = (row: AiProviderRow): ProviderConfig => ({
  id: row.id,
  kind: row.kind as ProviderKind,
  label: row.label,
  baseUrl: row.baseUrl,
  apiKey: row.apiKey,
  model: row.model,
  transport: row.transport as ProviderConfig['transport'],
  redact: row.redact,
})

const toRow = (config: ProviderConfig): Omit<AiProviderRow, 'createdAt' | 'updatedAt'> => ({ ...config })

export async function loadProviders(): Promise<void> {
  providers.value = (await repos.aiProviders.list()).map(toConfig)
  if (providers.value.length && !providers.value.some((p) => p.id === activeProviderId.value)) {
    setActiveProvider(providers.value[0]?.id ?? '')
  }
  status.value = providers.value.length ? 'idle' : 'unconfigured'
}

export function setActiveProvider(id: string): void {
  activeProviderId.value = id
  localStorage.setItem(ACTIVE_KEY, id)
  models.value = []
  usingNativeTransport.value = false
}

export async function saveProvider(config: ProviderConfig): Promise<void> {
  await repos.aiProviders.save(toRow(config))
  await loadProviders()
  if (!activeProviderId.value) setActiveProvider(config.id)
}

export async function removeProvider(id: string): Promise<void> {
  await repos.aiProviders.remove(id)
  if (activeProviderId.value === id) setActiveProvider('')
  await loadProviders()
}

export function newProvider(kind: ProviderKind): ProviderConfig {
  return configFromPreset(kind, newId())
}

/** Presets for the "add provider" menu, local ones first. */
export const presetOptions = PRESET_ORDER.map((kind) => PROVIDER_PRESETS[kind])

/**
 * The transport wiring, resolved fresh each call.
 *
 * `net.request` is imported dynamically and only in the packaged app: on the web
 * there is no Neutralino, and a static import would pull the native client into the
 * startup bundle for a code path that can never run there.
 */
async function transportOptions(): Promise<TransportOptions> {
  const isNative = typeof (globalThis as { NL_PORT?: number }).NL_PORT !== 'undefined'
  if (!isNative) return { onNativeFallback: () => (usingNativeTransport.value = true) }

  const { net } = await import('@neutralinojs/lib')
  return {
    netRequest: net.request as TransportOptions['netRequest'],
    onNativeFallback: () => (usingNativeTransport.value = true),
  }
}

/** Ask a provider for its models. Doubles as the connection test. */
export async function listModels(config: ProviderConfig): Promise<ModelInfo[]> {
  status.value = 'testing'
  lastError.value = ''
  try {
    const found = await listProviderModels(config, await transportOptions())
    if (config.id === activeProviderId.value) models.value = found
    status.value = 'idle'
    return found
  } catch (error) {
    lastError.value = error instanceof Error ? error.message : String(error)
    status.value = 'error'
    throw error
  }
}

export async function testConnection(config: ProviderConfig): Promise<{ ok: true; models: number } | { ok: false; error: string }> {
  try {
    return { ok: true, models: (await listModels(config)).length }
  } catch (error) {
    return { ok: false, error: explainProviderError(error, config) }
  }
}

/**
 * Build the model for the active provider.
 *
 * Returns the locality alongside it so a caller cannot accidentally build a turn
 * against a cloud provider while believing it is local — the two travel together.
 */
export async function activeModel(): Promise<{ model: Awaited<ReturnType<typeof createModel>>['model']; locality: Locality }> {
  const config = activeProvider.value
  if (!config) throw new Error('Add an AI provider in Settings before using the assistant.')

  const { model } = createModel(config, config.model, await transportOptions())
  return { model, locality: localityOf(config.baseUrl) }
}

/**
 * Prepare text for sending, honouring the provider's redaction setting.
 *
 * Reuses the redaction the app already applies elsewhere, which strips values after
 * `api_key`/`password`/`secret`/`token` and `Authorization: Bearer`. It is a
 * backstop, not the privacy boundary — that is the tool gate in `@devdesk/ai`.
 */
export function prepareOutbound(text: string): string {
  return activeProvider.value?.redact ? redactText(text) : text
}

/**
 * Configure a local server if one happens to be running, so a first run needs no
 * setup. Silent by design: a failed probe means "not installed", which is the
 * ordinary case and not worth an error.
 */
export async function autodetectLocalProviders(): Promise<ProviderConfig | undefined> {
  if (providers.value.length > 0) return undefined

  for (const kind of AUTODETECT) {
    const candidate = configFromPreset(kind, newId())
    try {
      const found = await listProviderModels(candidate, await transportOptions())
      if (found.length === 0) continue
      const configured = { ...candidate, model: found[0]?.id ?? '' }
      await saveProvider(configured)
      return configured
    } catch {
      /* not running, or not reachable from here — try the next one */
    }
  }
  return undefined
}
