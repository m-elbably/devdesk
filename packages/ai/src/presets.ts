import type { Locality, ProviderConfig, ProviderKind } from './types'

export interface ProviderPreset {
  kind: ProviderKind
  label: string
  baseUrl: string
  /** Whether this provider needs an API key before it can be used at all. */
  needsKey: boolean
  /** Shown in settings when the provider can't be reached. */
  hint?: string
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  lmstudio: {
    kind: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    hint: 'Start the server with CORS enabled: `lms server start --cors`, or tick "Enable CORS" in Developer → Server Settings.',
  },
  ollama: {
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    hint: 'Ollama blocks browser origins unless OLLAMA_ORIGINS is set. Restart it with OLLAMA_ORIGINS=* (or this app\'s origin).',
  },
  deepseek: { kind: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  openai: { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsKey: true,
  },
  custom: { kind: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', needsKey: false },
}

/** Presets offered in the "add provider" menu, local ones first. */
export const PRESET_ORDER: ProviderKind[] = ['lmstudio', 'ollama', 'deepseek', 'openai', 'gemini', 'custom']

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/** True for the private IPv4 ranges plus IPv4 link-local. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = nums as [number, number, number, number]
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  return false
}

/**
 * Where a provider's traffic goes, decided from its URL alone.
 *
 * This is the privacy gate's input: `LOCAL_ONLY` and `NEVER_PERSIST` tools are
 * withheld from any provider that isn't local (see `toolbelt.ts`). It therefore
 * **fails closed** — anything we cannot positively prove stays on this machine,
 * including an unparseable URL, is treated as remote.
 */
export function localityOf(baseUrl: string): Locality {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return 'remote'
  }

  // Strip IPv6 brackets so ::1 and [::1] compare alike.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (LOOPBACK_NAMES.has(host)) return 'local'
  // mDNS names resolve on the local network segment only.
  if (host === 'local' || host.endsWith('.local')) return 'local'
  if (isPrivateIpv4(host)) return 'local'
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return 'local'
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return 'local'

  return 'remote'
}

export const isLocalProvider = (config: Pick<ProviderConfig, 'baseUrl'>): boolean =>
  localityOf(config.baseUrl) === 'local'

/** A new provider config from a preset, with sensible per-locality defaults. */
export function configFromPreset(kind: ProviderKind, id: string): ProviderConfig {
  const preset = PROVIDER_PRESETS[kind]
  return {
    id,
    kind,
    label: preset.label,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: '',
    transport: 'auto',
    // Redaction is on by default wherever the text would leave the machine.
    redact: localityOf(preset.baseUrl) === 'remote',
  }
}
