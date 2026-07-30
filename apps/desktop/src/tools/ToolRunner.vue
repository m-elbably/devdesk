<script setup lang="ts">
import { reactive, ref, watch, computed, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { getPlugin, getTool, analyzePassword } from '@devdesk/tools'
import { canPersistHistory } from '@devdesk/shared'
import { newId, nowIso, debounce } from '@devdesk/utils'
import { CopyButton, ErrorState, EmptyState, LoadingState } from '@devdesk/ui'
import { ArrowRight, CheckCircle2 } from 'lucide-vue-next'
import type { JsonChange, OtpResult } from '@devdesk/tools'
import CodeBlock from '@/components/CodeBlock.vue'
import JsonDiffView from '@/components/JsonDiffView.vue'
import JsonEditor from '@/components/JsonEditor.vue'
import JwtView from '@/components/JwtView.vue'
import TimelineBar from './TimelineBar.vue'
import BitRuler from './BitRuler.vue'
import ColorSwatch from './ColorSwatch.vue'
import ChmodGrid from './ChmodGrid.vue'
import SubnetMap from './SubnetMap.vue'
import Histogram from './Histogram.vue'
import RatioBox from './RatioBox.vue'
import { TOOL_UI, type Field } from './ui-spec'
import { services } from '@/services'
import { desktop } from '@/services/desktop'
import { bus } from '@/lib/events'

const props = defineProps<{ toolId: string }>()

const spec = computed(() => TOOL_UI[props.toolId])
const plugin = computed(() => getPlugin(props.toolId))
const meta = computed(() => getTool(props.toolId))

// The one textarea field (if any) becomes the main Input pane; everything else
// is a compact control in the toolbar. Editor look (line numbers) only makes
// sense when the output itself is code/json.
type TextareaField = Field & { kind: 'textarea' }
const textareaFields = computed(
  () => spec.value?.fields.filter((f): f is TextareaField => f.kind === 'textarea') ?? [],
)
// A field with `showWhen` only renders when its controlling field matches.
const fieldVisible = (f: Field): boolean =>
  !f.showWhen || f.showWhen.in.includes(String(model[f.showWhen.field]))
const toolbarFields = computed(() => spec.value?.fields.filter((f) => f.kind !== 'textarea' && fieldVisible(f)) ?? [])

// Option labels shown to the user. Acronyms/discrete codes (SHA-256, MD5,
// base64url, AES…) stay as-is; only a single leading lowercase letter gets
// capitalized so group choices like "binary" read as "Binary".
function displayOption(o: string): string {
  return /^[a-z][a-zA-Z0-9-]*$/.test(o) ? o.charAt(0).toUpperCase() + o.slice(1) : o
}
function step(f: Field & { kind: 'number' }, dir: number) {
  let next = (Number(model[f.name]) || 0) + dir * (f.step ?? 1)
  if (f.min !== undefined) next = Math.max(f.min, next)
  if (f.max !== undefined) next = Math.min(f.max, next)
  model[f.name] = next
}

// A number field's raw typed value can land outside min/max or off the step grid.
// Rather than let e.g. a wildly out-of-range bit count run (and, for something
// like RSA keygen, look "stuck" while the engine chokes on it), reject it up
// front: clamp the model to the nearest valid value and toast why, so the run
// that actually fires always uses a bounded, sane input.
function clampField(f: Field & { kind: 'number' }): string | null {
  const v = Number(model[f.name])
  let clamped = v
  let message: string | null = null
  if (f.min !== undefined && v < f.min) {
    clamped = f.fallback ?? f.min
    message = `${f.label} must be at least ${f.min} — using ${clamped}.`
  } else if (f.max !== undefined && v > f.max) {
    clamped = f.fallback ?? f.max
    message = `${f.label} must be at most ${f.max} — using ${clamped}.`
  } else if (f.step && f.step > 1 && v % f.step !== 0) {
    clamped = Math.round(v / f.step) * f.step
    message = `${f.label} must be a multiple of ${f.step} — using ${clamped}.`
  }
  if (message) model[f.name] = clamped
  return message
}
function warnOutOfRange() {
  for (const f of spec.value?.fields ?? []) {
    if (f.kind !== 'number') continue
    const message = clampField(f)
    if (message) {
      bus.emit('toast', { type: 'info', message })
      return
    }
  }
}
// Text outputs (code/json/plain text) render in the line-numbered editor panel;
// svg/list/keyvalue have their own richer rendering.
const editorOutput = computed(
  () => spec.value?.output === 'code' || spec.value?.output === 'json' || spec.value?.output === 'text',
)

// Soft-wrap on by default: most tool inputs (a User-Agent, a base64 blob, a JWT)
// are one very long line, which is unreadable in a horizontally-scrolling box.
// Off restores the line-numbered, non-wrapping editor view for real multi-line code.
const wrapInput = ref(true)

async function pasteInto(name: string) {
  try {
    model[name] = await navigator.clipboard.readText()
  } catch {
    // Clipboard permission denied or unavailable — ignore, user can still type/paste manually.
  }
}

// Native datetime-local/color pickers feeding a free-text field. A datetime-local
// value has no timezone marker ("2026-07-19T15:30:00"), which Date.parse — and
// this app's own parseDate — both read as local wall-clock time, matching what
// the picker shows. A color picker's value is always a #rrggbb hex string,
// which the color-converter's own parser already accepts.
function pickValue(name: string, value: string) {
  if (value) model[name] = value
}

// The IANA database itself, no library — every zone the runtime knows about,
// searchable by the select menu's built-in filter.
const timeZoneItems = Intl.supportedValuesOf('timeZone').map((zone) => ({
  label: zone.replace(/_/g, ' '),
  value: zone,
}))
// The `zones` field models a comma-separated string, matching what the plugin
// schema and manual typing both expect — the multi-select just edits that
// string as an array instead of asking for one round-trip through free text.
function zonesArray(name: string): string[] {
  return String(model[name] ?? '').split(',').map((z) => z.trim()).filter(Boolean)
}
function setZonesArray(name: string, values: string[]) {
  model[name] = values.join(', ')
}

function initialValue(f: Field): unknown {
  if (f.kind === 'checkbox') return f.default ?? false
  if (f.kind === 'number') return f.default ?? 0
  if (f.kind === 'select') return f.default ?? f.options[0]
  return f.default ?? ''
}

// Editable model, keyed by field name to match the plugin schema.
const model = reactive<Record<string, unknown>>({})
const result = ref<unknown>(null)
const error = ref('')
// Clear all: reset inputs *and* wipe the output (e.g. generated UUIDs).
function resetModel() {
  for (const key of Object.keys(model)) delete model[key]
  for (const f of spec.value?.fields ?? []) model[f.name] = initialValue(f)
  result.value = null
  error.value = ''
}
resetModel()

// Required text/textarea inputs blank → nothing to run. Fields with a default
// (e.g. json-to-ts's rootName, regex-tester's flags) are auxiliary, not the
// thing the user is expected to type, so they don't count here. Clear quietly
// so the output shows its empty state instead of a scary parse error.
function inputsEmpty(): boolean {
  const required =
    spec.value?.fields.filter((f) => (f.kind === 'textarea' || f.kind === 'text') && f.default === undefined) ?? []
  return required.length > 0 && required.every((f) => !(model[f.name] as string)?.trim())
}

// RSA key generation runs in a worker (see rsa-keygen.worker.ts) instead of
// plugin.run() directly — large moduli can otherwise hang the whole window.
// Lazily created, reused across generations.
let rsaWorker: Worker | null = null
// Large-but-in-range sizes (e.g. 16384) can take an engine-dependent, effectively
// unbounded amount of time instead of failing fast — cap the wait so it never just
// sits there looking stuck, and discard the worker since a native keygen call
// can't be cancelled, only the whole thread killed.
const RSA_KEYGEN_TIMEOUT_MS = 20_000
function runRsaKeygen(bits: number): Promise<{ publicKey: string; privateKey: string }> {
  rsaWorker ??= new Worker(new URL('../workers/rsa-keygen.worker.ts', import.meta.url), { type: 'module' })
  const worker = rsaWorker
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ ok: true; result: { publicKey: string; privateKey: string } } | { ok: false; error: string }>) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error))
    }
    const timer = setTimeout(() => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      rsaWorker = null
      reject(new Error(`Generating a ${bits}-bit key is taking too long on this device — try 4096 bits or smaller.`))
    }, RSA_KEYGEN_TIMEOUT_MS)
    worker.addEventListener('message', onMessage)
    worker.postMessage({ bits })
  })
}
onUnmounted(() => rsaWorker?.terminate())

const busy = ref(false)
async function execute() {
  error.value = ''
  if (inputsEmpty()) {
    result.value = null
    return
  }
  // Only manual (button-triggered) runs warn — live tools would spam a toast per keystroke.
  if (spec.value?.manual) warnOutOfRange()
  busy.value = true
  try {
    result.value = props.toolId === 'rsa-keypair' ? await runRsaKeygen(model.bits as number) : await plugin.value!.run({ ...model })
  } catch (e) {
    result.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

// Live tools recompute on input; manual tools (random generators) wait for the button.
onMounted(() => {
  if (!spec.value?.manual) void execute()
})
watch(model, () => {
  if (!spec.value?.manual) void execute()
})

// liveTick tools (e.g. TOTP) recompute every second so a time-based code keeps
// rolling over without needing an input change to trigger it.
const tickTimer = setInterval(() => {
  if (spec.value?.liveTick && !spec.value.manual) void execute()
}, 1000)
onUnmounted(() => clearInterval(tickTimer))

// Reset everything when navigating between tools.
watch(
  () => props.toolId,
  () => {
    resetModel()
    result.value = null
    error.value = ''
    if (!spec.value?.manual) void execute()
  },
)

// --- Output shaping ---
const asText = computed(() => (typeof result.value === 'string' ? result.value : ''))
const asList = computed(() => (Array.isArray(result.value) ? (result.value as unknown[]).map(String) : []))
const asEntries = computed(() =>
  result.value && typeof result.value === 'object' && !Array.isArray(result.value)
    ? Object.entries(result.value as Record<string, unknown>)
    : [],
)
const asJson = computed(() => (result.value == null ? '' : JSON.stringify(result.value, null, 2)))
const asDiff = computed<JsonChange[]>(() =>
  spec.value?.output === 'diff' && Array.isArray(result.value) ? (result.value as JsonChange[]) : [],
)
const diffCounts = computed(() => {
  const counts = { added: 0, removed: 0, changed: 0 }
  for (const c of asDiff.value) counts[c.kind]++
  return counts
})
const sanitizeSvg = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
const safeSvg = computed(() => sanitizeSvg(asText.value))
const asKeyPair = computed(() => {
  if (spec.value?.output !== 'keypair' || !result.value || typeof result.value !== 'object') return null
  const r = result.value as { publicKey?: string; privateKey?: string }
  return r.publicKey && r.privateKey ? (r as { publicKey: string; privateKey: string }) : null
})
function exportKey(filename: string, content: string | undefined) {
  if (content) void desktop.saveTextFile(filename, content)
}

// TOTP/HOTP: a big, glanceable code rather than a generic key/value table —
// the code is the entire point of the tool, and pairing it with a countdown
// ring (TOTP) makes the expiry visible instead of a text line you have to read.
const asOtp = computed(() => {
  if (spec.value?.output !== 'otp' || !result.value || typeof result.value !== 'object') return null
  return result.value as OtpResult
})
// Grouped like an authenticator app: "123 456" / "1234 5678", easier to read and re-type than one long run.
const otpGroups = computed(() => {
  const code = asOtp.value?.code ?? ''
  const half = Math.ceil(code.length / 2)
  return [code.slice(0, half), code.slice(half)]
})
const otpRingPct = computed(() => {
  const o = asOtp.value
  if (!o?.period || o.secondsRemaining === undefined) return null
  return Math.round((o.secondsRemaining / o.period) * 100)
})
const otpRingColor = computed(() => {
  const pct = otpRingPct.value
  if (pct === null) return 'success'
  return pct <= 15 ? 'error' : pct <= 35 ? 'warning' : 'success'
})
// Enrolment QR for the otpauth:// URI — scan it to load the same secret into a
// real authenticator app. Hidden behind a toggle: it encodes the secret, so it
// shouldn't be on screen (or on a screen share) unless asked for.
const showEnrolQr = ref(false)
const otpQr = computed(() => (asOtp.value?.qr ? sanitizeSvg(asOtp.value.qr) : ''))

function nextHotpCounter() {
  if (typeof model.counter === 'number') model.counter++
}

// JWT: header/payload/signature rendered as linked, colour-coded cards rather
// than one JSON blob (see JwtView).
const asJwt = computed(() => {
  if (spec.value?.output !== 'jwt' || !result.value || typeof result.value !== 'object') return null
  return result.value as { header: Record<string, unknown>; payload: Record<string, unknown>; signature: string }
})

// Visual strength meter shown below the output for password-generating tools.
const strength = computed(() =>
  spec.value?.strengthMeter && asText.value ? analyzePassword(asText.value) : null,
)
const STRENGTH_TIERS = [
  { max: 25, label: 'Weak', color: 'error' },
  { max: 50, label: 'Fair', color: 'warning' },
  { max: 75, label: 'Good', color: 'warning' },
  { max: 90, label: 'Strong', color: 'success' },
  { max: 101, label: 'Excellent', color: 'success' },
] as const
const strengthTier = computed(() => STRENGTH_TIERS.find((t) => (strength.value?.score ?? 0) < t.max)!)
const charsetBadges = computed(() => [
  { label: 'a-z', on: !!strength.value?.hasLower },
  { label: 'A-Z', on: !!strength.value?.hasUpper },
  { label: '0-9', on: !!strength.value?.hasDigits },
  { label: '!@#', on: !!strength.value?.hasSymbols },
])

// --- Visuals ---
// A `visual` in the spec adds a graphic above the output, derived from the
// key/value result the tool already returns — so a tool opts in with one spec
// line and no plugin change. Everything below reads `row()`, nothing else.
const row = (key: string): string => String(asEntries.value.find(([k]) => k === key)?.[1] ?? '')

// Which two result rows bound the span, and what to call them.
const TIMELINE_ROWS: Record<string, [string, string, string, string]> = {
  'cert-parser': ['Valid from', 'Valid to', 'Issued', 'Expires'],
  'duration-calculator': ['From', 'To', 'Start', 'End'],
  // The "now" marker on a start→finish span *is* the progress bar, so the ETA
  // tool gets its progress visual for free from the existing component.
  eta: ['Started', 'Finishes at', 'Started', 'Done'],
}
const timeline = computed(() => {
  const keys = spec.value?.visual === 'timeline' ? TIMELINE_ROWS[props.toolId] : undefined
  if (!keys) return null
  const [a, b] = [Date.parse(row(keys[0])), Date.parse(row(keys[1]))]
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return null
  // "Subtract 7 days" puts the result before the origin; the bar still runs
  // left-to-right, so swap the ends and the labels with them.
  return a < b
    ? { from: a, to: b, fromLabel: keys[2], toLabel: keys[3] }
    : { from: b, to: a, fromLabel: keys[3], toLabel: keys[2] }
})

// CIDR splits its 32 bits into network/host; a plain conversion has no prefix,
// so the ruler just lays the octets out.
const bits = computed(() => {
  if (spec.value?.visual !== 'bits') return null
  const address = row('Address') || row('IPv4')
  if (!address) return null
  const prefix = Number(row('Network').split('/')[1])
  return { address, prefix: Number.isInteger(prefix) ? prefix : undefined }
})

const swatch = computed(() => {
  if (spec.value?.visual !== 'swatch') return null
  const color = row('Hex')
  const ratio = (key: string) => Number.parseFloat(row(key))
  return color ? { color, onWhite: ratio('Contrast on white'), onBlack: ratio('Contrast on black') } : null
})

// Two-way tools (encode/decode, encrypt/decrypt) can feed their own output back
// in with the mode flipped — the round-trip you'd otherwise do by hand with two
// copy-pastes. Detected rather than configured: one text input, one two-option
// `mode` select, a text result.
const swapField = computed(() => {
  if (spec.value?.output !== 'text' || textareaFields.value.length !== 1) return null
  const f = spec.value.fields.find((x) => x.name === 'mode' && x.kind === 'select')
  return f?.kind === 'select' && f.options.length === 2 ? f : null
})
const canSwap = computed(() => !!swapField.value && !!asText.value && !error.value)
function swap() {
  const f = swapField.value
  if (!f) return
  model[textareaFields.value[0]!.name] = asText.value
  model.mode = f.options.find((o) => o !== model.mode) ?? model.mode
}

// Character and byte counts. Encoding tools change size in ways worth seeing
// (Base64 inflates ~33%, percent-encoding more), and for text a UTF-8 byte count
// is the number that actually matters at a wire or column-limit boundary.
const encoder = new TextEncoder()
function sizeLabel(s: string): string {
  if (!s) return ''
  const chars = [...s].length
  const bytes = encoder.encode(s).length
  return chars === bytes ? `${chars} chars` : `${chars} chars · ${bytes} bytes`
}
const showSizes = computed(() => spec.value?.output === 'text' || spec.value?.output === 'code')

// null = nothing typed yet, so the dot stays neutral rather than claiming invalid.
const validityClass = (valid: boolean | null) =>
  valid === null ? 'bg-elevated' : valid ? 'bg-success' : 'bg-error'

const optionItems = (options: readonly string[]) =>
  options.map((o) => ({ label: displayOption(o), value: o }))

// A preset can be a long value (a whole list of time zones); the chip shows a
// readable stand-in while the click still fills in the full value.
function presetLabel(preset: string): string {
  if (preset.length <= 14) return preset
  // The "+n more" form only makes sense for a comma-separated list (a set of time
  // zones). A single long value — an IP range, a CIDR — is one thing, so show it
  // whole rather than claiming "+0" others.
  const parts = preset.split(',')
  if (parts.length < 2) return preset
  return `${parts[0]!.trim().split('/').pop()} +${parts.length - 1}`
}

// Colour-ish values get a swatch next to them in the key/value table. Detected
// from the value rather than declared per tool — anything that renders a colour
// (the converter's hex/rgb/hsl rows) gets one for free.
// Pass/fail/warning rows tint themselves. Tools already lead such values with a
// ✓/✗/⚠ (the cookie inspector's flag warnings, the CIDR matcher's verdicts), so
// the colour comes free rather than needing a per-tool declaration.
const VERDICTS: [string, string][] = [
  ['✓', 'text-success'],
  ['✗', 'text-error'],
  ['⚠', 'text-warning'],
]
const verdictClass = (v: string) => VERDICTS.find(([mark]) => v.trimStart().startsWith(mark))?.[1] ?? ''

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i
const isColorValue = (v: string) => COLOR_VALUE.test(v.trim()) && CSS.supports('color', v.trim())

// Live JSON validity pill for the editor-backed JSON tools, so the user gets
// an inline cue *before* a parse error surfaces as a top alert.
const jsonField = computed(() => textareaFields.value.find((f) => f.name === 'text'))
const isJsonTool = computed(
  () => !!jsonField.value && (spec.value?.output === 'code' || spec.value?.output === 'json'),
)
// Whether a given textarea field should render the light vanilla-jsoneditor
// instead of a plain CodeBlock. JSON-category tools (diff/to-ts) get the editor;
// other textareas (base64, jwt-parser, …) stay as CodeBlock.
const isJsonEditorField = (f: Field): boolean =>
  meta.value?.category === 'json' && (f.kind === 'textarea')
const jsonValid = computed(() => {
  if (!isJsonTool.value || !model[jsonField.value!.name]) return null
  try {
    JSON.parse(model[jsonField.value!.name] as string)
    return true
  } catch {
    return false
  }
})

// Empty-state copy per output kind, so a blank output panel explains itself
// instead of showing an empty bordered box.
const emptyHint = computed(() => {
  if (spec.value?.output === 'diff') return 'Enter JSON on both sides to compare.'
  if (isJsonTool.value) return 'Enter JSON above to see the result.'
  return 'Provide input above to see the result.'
})

// Per-side validity for the diff tool, mirroring the inline pill on the
// single-input JSON tools so every JSON tool cues validity the same way.
const sideValid = (name: string): boolean | null => {
  const v = model[name]
  if (!v) return null
  try {
    JSON.parse(v as string)
    return true
  } catch {
    return false
  }
}

// Minified JSON diffs as one giant line, which makes the split view useless.
// Pretty-print both sides so the line-based diff has lines to align. Invalid
// sides are left alone — the validity dots already flag them.
function formatBoth() {
  for (const name of ['left', 'right'] as const) {
    if (sideValid(name) !== true) continue
    model[name] = JSON.stringify(JSON.parse(model[name] as string), null, 2)
  }
}
const canFormat = computed(() => sideValid('left') === true || sideValid('right') === true)

// Compact one-line rendering of a changed value for the summary rows, so the
// list says what changed and not just where.
function preview(v: unknown): string {
  const s = JSON.stringify(v) ?? 'undefined'
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}

const copyText = computed(() => {
  switch (spec.value?.output) {
    case 'list': return asList.value.join('\n')
    case 'json': return asJson.value
    case 'keyvalue': return asEntries.value.map(([k, v]) => `${k}: ${v}`).join('\n')
    case 'diff': return asDiff.value
      .map((c) => `${c.kind} ${c.path}: ${c.kind === 'changed' ? `${preview(c.before)} -> ${preview(c.after)}` : preview(c.kind === 'added' ? c.after : c.before)}`)
      .join('\n')
    case 'keypair': return asKeyPair.value ? `${asKeyPair.value.publicKey}\n\n${asKeyPair.value.privateKey}` : ''
    case 'otp': return asOtp.value?.code ?? ''
    case 'jwt': return asJson.value
    default: return asText.value
  }
})

// Empty arrays (no diff, no list items) count as "no result" so the header
// actions stay hidden.
const hasResult = computed(
  () => result.value !== null && result.value !== '' && !(Array.isArray(result.value) && result.value.length === 0),
)

// Click a list row (e.g. a generated UUID) to copy it, with a brief "copied" cue.
const copiedIndex = ref(-1)
async function copyItem(item: string, i: number) {
  try {
    await navigator.clipboard.writeText(item)
    copiedIndex.value = i
    setTimeout(() => { if (copiedIndex.value === i) copiedIndex.value = -1 }, 1000)
  } catch {
    // Clipboard unavailable — ignore.
  }
}

// Click the big OTP code to copy it, mirroring the list row copy-on-click cue.
const copiedOtp = ref(false)
async function copyOtpCode() {
  if (!asOtp.value?.code) return
  try {
    await navigator.clipboard.writeText(asOtp.value.code)
    copiedOtp.value = true
    setTimeout(() => (copiedOtp.value = false), 1000)
  } catch {
    // Clipboard unavailable — ignore.
  }
}

// Record execution history, but only when the tool's privacy level permits it.
// NEVER_PERSIST tools (e.g. JWT parser) never touch disk. Debounced so live typing
// doesn't spam the log.
const recordHistory = debounce(() => {
  if (!meta.value || !hasResult.value || !canPersistHistory(meta.value.privacyLevel)) return
  void services.toolUsage.history.add({
    id: newId(),
    toolId: props.toolId,
    input: { ...model },
    output: result.value,
    createdAt: nowIso(),
  })
}, 1200)
// liveTick tools recompute every second, so recording each result would bury the
// log in near-identical entries — key their history off input changes instead.
watch(result, () => {
  if (!spec.value?.liveTick) recordHistory()
})
watch(model, () => {
  if (spec.value?.liveTick) recordHistory()
})

// Restore a past run from the history dialog. Only known field names are taken —
// a stored entry predates any spec change, so a stale key would otherwise be
// handed to the plugin's schema and blow up on parse.
function loadModel(input: Record<string, unknown>) {
  for (const f of spec.value?.fields ?? []) {
    if (f.name in input) model[f.name] = input[f.name]
  }
  if (spec.value?.manual) void execute()
}

// "Save as snippet" — the catalog has advertised supportsSnippets on every tool
// since day one with nothing reading it. Withheld for NEVER_PERSIST tools:
// a snippet is a disk write, which is exactly what that level forbids.
const canSaveSnippet = computed(
  () => !!meta.value?.supportsSnippets && !!meta.value && canPersistHistory(meta.value.privacyLevel) && hasResult.value,
)
async function saveAsSnippet() {
  if (!meta.value || !copyText.value) return
  try {
    await services.snippets.create({
      title: `${meta.value.name} output`,
      code: copyText.value,
      language: spec.value?.language ?? 'text',
      tags: [],
    } as never)
    bus.emit('toast', { type: 'success', message: `Saved to snippets as "${meta.value.name} output".` })
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Could not save snippet.' })
  }
}

defineExpose({ resetModel, loadModel })
</script>

<template>
  <div v-if="!spec || !plugin" class="text-default/60">This tool has no UI configured.</div>

  <div v-else class="flex flex-col h-full min-h-0">
    <!-- Toolbar: every non-textarea field, run/clear actions, and a status readout -->
    <div class="flex flex-wrap items-center gap-2 shrink-0 mb-4">
      <template v-for="f in toolbarFields" :key="f.name">
        <div v-if="f.newRow" class="basis-full h-0" />
        <UFieldGroup v-if="f.kind === 'select' && f.options.length <= 5" size="sm">
          <UButton
            v-for="o in f.options"
            :key="o"
            type="button"
            color="neutral"
            :variant="model[f.name] === o ? 'solid' : 'outline'"
            :aria-label="o"
            :aria-pressed="model[f.name] === o"
            @click="model[f.name] = o"
          >
            {{ displayOption(o) }}
          </UButton>
        </UFieldGroup>
        <label v-else-if="f.kind === 'select'" class="flex items-center gap-1.5 text-sm">
          <span class="text-muted">{{ f.label }}</span>
          <USelect v-model="model[f.name] as string" size="sm" :items="optionItems(f.options)" />
        </label>
        <label v-else-if="f.kind === 'number'" class="flex items-center gap-1.5 text-sm">
          <span class="text-muted">{{ f.label }}</span>
          <UFieldGroup size="sm">
            <UButton type="button" color="neutral" variant="outline" aria-label="Decrease" @click="step(f, -1)">−</UButton>
            <UInput
              v-model.number="model[f.name] as number"
              type="number"
              class="w-16"
              :ui="{ base: 'text-center' }"
              :min="f.min"
              :max="f.max"
            />
            <UButton type="button" color="neutral" variant="outline" aria-label="Increase" @click="step(f, 1)">+</UButton>
          </UFieldGroup>
        </label>
        <template v-else-if="f.kind === 'text'">
          <label class="flex items-center gap-1.5 text-sm">
            <span v-if="f.label" class="text-muted shrink-0">{{ f.label }}</span>
            <UInput
              v-model="model[f.name] as string"
              size="sm"
              :class="[f.label ? '' : 'w-64', f.nowrap ? 'flex-1 min-w-0' : '', f.wide ? 'w-72' : '']"
              :placeholder="f.placeholder"
            />
          </label>
          <template v-if="f.copyPaste">
            <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-clipboard-paste" title="Paste" aria-label="Paste" @click="pasteInto(f.name)" />
            <CopyButton :value="(model[f.name] as string) ?? ''" />
          </template>
          <input
            v-if="f.datePicker"
            type="datetime-local"
            step="1"
            class="date-picker-input"
            title="Pick a date & time"
            aria-label="Pick a date and time"
            @input="pickValue(f.name, ($event.target as HTMLInputElement).value)"
          >
          <input
            v-if="f.colorPicker"
            type="color"
            class="color-picker-input"
            title="Pick a color"
            aria-label="Pick a color"
            :value="/^#[0-9a-f]{6}$/i.test(String(model[f.name])) ? model[f.name] : '#000000'"
            @input="pickValue(f.name, ($event.target as HTMLInputElement).value)"
          >
          <UButton
            v-for="p in f.presets ?? []"
            :key="p"
            type="button"
            color="neutral"
            :variant="model[f.name] === p ? 'solid' : 'soft'"
            size="xs"
            class="font-mono"
            :title="`Use ${p}`"
            :aria-pressed="model[f.name] === p"
            @click="model[f.name] = p"
          >
            {{ presetLabel(p) }}
          </UButton>
        </template>
        <template v-else-if="f.kind === 'timezones'">
          <label class="flex items-center gap-1.5 text-sm">
            <span class="text-muted shrink-0">{{ f.label }}</span>
            <USelectMenu
              :model-value="zonesArray(f.name)"
              multiple
              value-key="value"
              label-key="label"
              :items="timeZoneItems"
              :search-input="{ placeholder: 'Search zones…' }"
              placeholder="Add a time zone"
              class="w-72"
              size="sm"
              @update:model-value="setZonesArray(f.name, $event as string[])"
            />
          </label>
          <UButton
            v-for="p in f.presets ?? []"
            :key="p.value"
            type="button"
            color="neutral"
            :variant="model[f.name] === p.value ? 'solid' : 'soft'"
            size="xs"
            :title="`Use ${p.value}`"
            :aria-pressed="model[f.name] === p.value"
            @click="model[f.name] = p.value"
          >
            {{ p.label }}
          </UButton>
        </template>
        <UCheckbox v-else v-model="model[f.name] as boolean" size="sm" :label="f.label" />
      </template>

      <UButton v-if="spec.manual" color="primary" size="sm" :loading="busy" @click="execute">
        {{ busy ? 'Working…' : (spec.actionLabel ?? 'Run') }}
      </UButton>

      <div class="flex-1" />
    </div>

    <div class="grid gap-4 flex-1 min-h-0" :class="textareaFields.length ? 'lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]' : ''">
      <!-- json-diff: one GitHub-style split view instead of two separate panels. -->
      <div v-if="spec.output === 'diff'" class="flex flex-col min-h-0 min-w-0 lg:col-span-2">
        <div class="flex items-center justify-between h-7 shrink-0">
          <span class="text-sm font-medium text-default/60">Left / Right</span>
          <div class="flex items-center gap-1">
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-clipboard-paste" title="Paste left" @click="pasteInto('left')">Left</UButton>
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-clipboard-paste" title="Paste right" @click="pasteInto('right')">Right</UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-align-left"
              :disabled="!canFormat"
              title="Pretty-print both sides"
              @click="formatBoth"
            >
              Format
            </UButton>
            <span
              v-if="sideValid('left') !== null || sideValid('right') !== null"
              class="flex items-center gap-1.5 mx-1"
            >
              <span class="validity-dot" :class="validityClass(sideValid('left'))" title="Left JSON validity" />
              <span class="validity-dot" :class="validityClass(sideValid('right'))" title="Right JSON validity" />
            </span>
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" title="Clear both" aria-label="Clear both" @click="model.left = ''; model.right = ''" />
          </div>
        </div>
        <JsonDiffView
          class="flex-1 min-h-0 mt-1.5"
          :left="(model.left as string) ?? ''"
          :right="(model.right as string) ?? ''"
          @update:left="model.left = $event"
          @update:right="model.right = $event"
        />
      </div>

      <!-- Inputs: one panel per textarea field -->
      <template v-else>
        <div v-for="f in textareaFields" :key="f.name" class="flex flex-col min-h-0 min-w-0">
          <div class="flex items-center justify-between h-7 shrink-0">
            <span class="text-sm font-medium text-default/60">{{ f.label }}</span>
            <div class="flex items-center gap-1.5">
              <span v-if="showSizes && model[f.name]" class="text-xs tabular-nums text-default/40">
                {{ sizeLabel((model[f.name] as string) ?? '') }}
              </span>
              <span
                v-if="jsonField && f.name === jsonField.name && jsonValid !== null"
                class="validity-dot"
                :class="validityClass(jsonValid)"
                :title="jsonValid ? 'Valid JSON' : 'Invalid JSON'"
              />
              <UButton
                v-if="!isJsonEditorField(f)"
                color="neutral"
                :variant="wrapInput ? 'soft' : 'ghost'"
                size="xs"
                icon="i-lucide-wrap-text"
                :title="wrapInput ? 'Wrapping long lines — click to scroll instead' : 'Scrolling long lines — click to wrap'"
                :aria-pressed="wrapInput"
                aria-label="Toggle line wrapping"
                @click="wrapInput = !wrapInput"
              />
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-clipboard-paste" title="Paste" aria-label="Paste" @click="pasteInto(f.name)" />
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" title="Clear" aria-label="Clear" @click="model[f.name] = ''" />
            </div>
          </div>
          <JsonEditor
            v-if="isJsonEditorField(f)"
            class="flex-1 min-h-0 mt-1.5"
            v-model="model[f.name] as string"
            :placeholder="f.placeholder"
          />
          <CodeBlock
            v-else
            fill
            editable
            line-numbers
            :wrap="wrapInput"
            class="flex-1 min-h-0 mt-1.5"
            :code="(model[f.name] as string) ?? ''"
            :language="spec.language"
            :placeholder="f.placeholder"
            @update:code="model[f.name] = $event"
          />
        </div>
      </template>

      <!-- Output. With two inputs (e.g. JSON diff) they fill the top row and the
           output spans full width below. -->
      <div class="flex flex-col min-h-0 min-w-0" :class="textareaFields.length >= 2 ? 'lg:col-span-2' : ''">
        <div class="flex items-center justify-between h-7 shrink-0">
          <span class="text-sm font-medium text-default/60">Output</span>
          <div v-if="hasResult && spec.output !== 'keypair' && spec.output !== 'otp'" class="flex items-center gap-1.5">
            <span v-if="showSizes && asText" class="text-xs tabular-nums text-default/40">
              {{ sizeLabel(asText) }}
            </span>
            <UButton
              v-if="canSwap"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-arrow-up-down"
              title="Send this output back to the input and flip the mode"
              @click="swap"
            >
              Swap
            </UButton>
            <UButton
              v-if="canSaveSnippet"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-scissors"
              title="Save this output as a snippet"
              aria-label="Save this output as a snippet"
              @click="saveAsSnippet"
            />
            <CopyButton :value="copyText" />
          </div>
        </div>

        <!-- The output component always renders (empty when there's no result yet),
             so the panel keeps a stable shape. An error shows as an alert above it,
             not in place of it. -->
        <div class="flex-1 min-h-0 mt-1.5 flex flex-col gap-2">
          <ErrorState v-if="error" :message="error" class="shrink-0" />

          <!-- Spec-declared visual, above the table it is derived from. -->
          <TimelineBar v-if="timeline" v-bind="timeline" class="shrink-0" />
          <BitRuler v-else-if="bits" v-bind="bits" class="shrink-0" />
          <ColorSwatch v-else-if="swatch" v-bind="swatch" class="shrink-0" />
          <SubnetMap v-else-if="spec.visual === 'subnets' && asEntries.length" :entries="asEntries" class="shrink-0" />
          <!-- Reads the raw input rather than the result table: a distribution
               needs every value, and the table only carries the summary of them. -->
          <Histogram v-else-if="spec.visual === 'histogram'" :text="String(model.numbers ?? '')" class="shrink-0" />
          <RatioBox
            v-else-if="spec.visual === 'ratio' && asEntries.length"
            :width="Number(model.width) || 0"
            :height="Number(model.height) || 0"
            :scaled="row('Scaled to width') || row('Scaled to height') || row('Fit inside box (contain)')"
            class="shrink-0"
          />
          <ChmodGrid
            v-else-if="spec.visual === 'chmod' && asEntries.length"
            :symbolic="String(asEntries.find(([k]) => k === 'Symbolic')?.[1] ?? '')"
            class="shrink-0"
            @update="model.mode = $event"
          />

          <div class="flex-1 min-h-0">
            <div v-if="spec.output === 'keypair'" class="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
              <div v-for="k in (['publicKey', 'privateKey'] as const)" :key="k" class="flex flex-col min-h-0">
                <div class="flex items-center justify-between h-7 shrink-0">
                  <span class="text-sm font-medium text-default/60">{{ k === 'publicKey' ? 'Public key' : 'Private key' }}</span>
                  <div v-if="asKeyPair" class="flex items-center gap-1">
                    <CopyButton :value="asKeyPair[k]" />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-download"
                      :title="`Export ${k === 'publicKey' ? 'public' : 'private'} key`"
                      :aria-label="`Export ${k === 'publicKey' ? 'public' : 'private'} key`"
                      @click="exportKey(k === 'publicKey' ? 'rsa-public.pem' : 'rsa-private.pem', asKeyPair[k])"
                    />
                  </div>
                </div>
                <pre
                  v-if="asKeyPair"
                  class="flex-1 min-h-0 mt-1.5 rounded-lg border border-default bg-muted/30 p-4 text-sm font-mono whitespace-pre-wrap break-all overflow-auto"
                >{{ asKeyPair[k] }}</pre>
                <LoadingState
                  v-else-if="busy"
                  label="Generating…"
                  class="flex-1 min-h-0 mt-1.5 rounded-lg border border-dashed border-default !py-0 justify-center"
                />
                <div
                  v-else
                  class="flex-1 min-h-0 mt-1.5 rounded-lg border border-dashed border-default flex items-center justify-center text-sm text-default/40 italic"
                >
                  No {{ k === 'publicKey' ? 'public' : 'private' }} key yet
                </div>
              </div>
            </div>
            <div
              v-else-if="spec.output === 'otp' && asOtp"
              class="h-full flex flex-col items-center justify-center gap-5 rounded-lg border border-default bg-muted/20"
            >
              <div class="flex items-center gap-6">
                <div
                  v-if="otpRingPct !== null"
                  class="ring-progress"
                  :style="{ '--value': otpRingPct, '--ring-color': `var(--ui-${otpRingColor})`, '--size': '4.5rem', '--thickness': '5px' }"
                  role="progressbar"
                  :aria-valuenow="otpRingPct"
                >
                  <span class="text-xs font-semibold text-default">{{ asOtp.secondsRemaining }}s</span>
                </div>
                <UButton
                  color="neutral"
                  variant="ghost"
                  class="h-auto gap-3 rounded-lg px-6 py-4"
                  title="Click to copy"
                  @click="copyOtpCode"
                >
                  <CheckCircle2 v-if="copiedOtp" class="size-6 text-success shrink-0" />
                  <span class="font-mono text-5xl font-bold tracking-widest tabular-nums">{{ otpGroups[0] }}<span class="mx-2 text-default/30">·</span>{{ otpGroups[1] }}</span>
                </UButton>
              </div>
              <div class="flex flex-col items-center gap-3">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :icon="showEnrolQr ? 'i-lucide-eye-off' : 'i-lucide-qr-code'"
                  @click="showEnrolQr = !showEnrolQr"
                >
                  {{ showEnrolQr ? 'Hide enrolment QR' : 'Show enrolment QR' }}
                </UButton>
                <div v-if="showEnrolQr" class="flex flex-col items-center gap-2">
                  <div class="rounded-lg border border-default bg-white p-2 size-44 [&>svg]:size-full" v-html="otpQr" />
                  <div class="flex items-center gap-1 text-xs text-default/60">
                    <span>Scan in an authenticator app, or copy the URI</span>
                    <CopyButton :value="asOtp.uri" />
                  </div>
                </div>
              </div>
              <div v-if="asOtp.counter !== undefined" class="flex items-center gap-3 text-sm text-default/60">
                <span>Counter: <span class="font-mono text-default">{{ asOtp.counter }}</span></span>
                <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" @click="nextHotpCounter">
                  Next code (counter {{ asOtp.nextCounter }})
                </UButton>
              </div>
            </div>
            <EmptyState
              v-else-if="!hasResult"
              title="Nothing yet"
              :description="emptyHint"
              class="h-full justify-center rounded-lg border border-dashed border-default"
            />
            <JwtView
              v-else-if="asJwt"
              :token="(model.token as string) ?? ''"
              :header="asJwt.header"
              :payload="asJwt.payload"
              :signature="asJwt.signature"
            />
            <JsonEditor
              v-else-if="editorOutput && meta?.category === 'json' && spec.language === 'json'"
              bare
              read-only
              :model-value="spec.output === 'json' ? asJson : asText"
            />
            <CodeBlock
              v-else-if="editorOutput"
              fill
              line-numbers
              :code="spec.output === 'json' ? asJson : asText"
              :language="spec.output === 'json' ? 'json' : spec.language"
            />
            <div v-else-if="spec.output === 'svg'" class="rounded-lg border border-default p-4 flex justify-center bg-white h-full overflow-auto" v-html="safeSvg" />
            <ul v-else-if="spec.output === 'list'" class="bg-default rounded-lg border border-default w-full h-full overflow-auto divide-y divide-muted">
              <li v-for="(item, i) in asList" :key="i">
                <UButton
                  block
                  color="neutral"
                  variant="ghost"
                  class="h-auto justify-start gap-1.5 rounded-none px-3 py-2 font-mono text-sm break-all"
                  title="Click to copy"
                  @click="copyItem(item, i)"
                >
                  <CheckCircle2 v-if="copiedIndex === i" class="size-3.5 text-success shrink-0" />{{ item }}
                </UButton>
              </li>
            </ul>
            <!-- Rows copy their value on click, mirroring the list output — every
                 part of a parsed URL/UA/timestamp is something you go on to paste. -->
            <div v-else-if="spec.output === 'keyvalue'" class="rounded-lg border border-default h-full overflow-auto">
              <table class="w-full text-sm">
                <tbody class="divide-y divide-muted">
                  <tr
                    v-for="([k, v], i) in asEntries"
                    :key="k"
                    tabindex="0"
                    class="cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                    :class="verdictClass(String(v))"
                    title="Click to copy this value"
                    @click="copyItem(String(v), i)"
                    @keydown.enter="copyItem(String(v), i)"
                  >
                    <td class="px-3 py-2 font-medium align-top whitespace-nowrap">{{ k }}</td>
                    <td class="px-3 py-2 font-mono break-all">
                      <CheckCircle2 v-if="copiedIndex === i" class="inline size-3.5 text-success mr-1 -mt-0.5" /><span
                        v-if="isColorValue(String(v))"
                        class="inline-block size-3.5 rounded-sm border border-default mr-1.5 -mb-0.5"
                        :style="{ background: String(v) }"
                      />{{ v }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- Diff is shown directly in the colored inputs; this is just a hint list of what/where changed. -->
            <div v-else-if="spec.output === 'diff'" class="rounded-lg border border-default h-full overflow-auto bg-default">
              <div v-if="asDiff.length" class="divide-y divide-muted font-mono text-sm">
                <div class="flex items-center gap-3 px-3 py-2 text-xs bg-muted/40">
                  <span v-if="diffCounts.added" class="text-success">+{{ diffCounts.added }} added</span>
                  <span v-if="diffCounts.removed" class="text-error">-{{ diffCounts.removed }} removed</span>
                  <span v-if="diffCounts.changed" class="text-warning">~{{ diffCounts.changed }} changed</span>
                </div>
                <div
                  v-for="(c, i) in asDiff"
                  :key="i"
                  class="flex items-start gap-3 px-3 py-1.5"
                >
                  <UBadge
                    :color="c.kind === 'added' ? 'success' : c.kind === 'removed' ? 'error' : 'warning'"
                    variant="soft"
                    size="sm"
                    class="shrink-0 w-16 justify-center mt-0.5"
                  >
{{ c.kind }}
</UBadge>
                  <div class="min-w-0 flex-1">
                    <span class="text-default/70 break-all">{{ c.path }}</span>
                    <div class="flex items-center gap-2 text-xs mt-0.5 break-all">
                      <span v-if="c.kind !== 'added'" class="text-error">{{ preview(c.before) }}</span>
                      <ArrowRight v-if="c.kind === 'changed'" class="size-3 shrink-0 text-default/40" />
                      <span v-if="c.kind !== 'removed'" class="text-success">{{ preview(c.after) }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p v-else-if="result !== null" class="p-3 text-sm text-success flex items-center gap-1.5">
                <CheckCircle2 class="size-4" />Documents are identical
              </p>
              <p v-else class="p-3 text-sm text-default/50">{{ emptyHint }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="strength" class="mt-4 shrink-0 rounded-lg border border-default bg-muted/40 p-4">
      <div class="flex items-center gap-4">
        <div
          class="ring-progress"
          :style="{ '--value': strength.score, '--ring-color': `var(--ui-${strengthTier.color})`, '--size': '3.5rem', '--thickness': '4px' }"
          role="progressbar"
          :aria-valuenow="strength.score"
        >
          <span class="text-xs font-semibold text-default">{{ strength.score }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold" :class="`text-${strengthTier.color}`">{{ strengthTier.label }}</span>
            <span class="text-xs text-default/60">{{ strength.entropy.toFixed(1) }} bits of entropy</span>
          </div>
          <p class="text-xs text-default/60 mt-0.5">
            Time to crack (brute force): <span class="font-medium text-default">{{ strength.crackTime }}</span>
          </p>
          <div class="flex gap-1.5 mt-2">
            <UBadge v-for="c in charsetBadges" :key="c.label" :color="c.on ? 'success' : 'neutral'" variant="soft" size="sm" :class="c.on ? '' : 'opacity-40'">
              {{ c.label }}
            </UBadge>
          </div>
        </div>
      </div>
      <div class="mt-3 h-1.5 rounded-full bg-elevated overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="`bg-${strengthTier.color}`"
          :style="{ width: `${strength.score}%` }"
        />
      </div>
    </div>

    <p v-if="spec.note" class="mt-4 shrink-0 rounded-lg border border-default bg-muted/40 p-3 text-sm text-default/70">
      <span class="font-medium text-default">Note:</span> {{ spec.note }}
    </p>
  </div>
</template>

<style scoped>
/* Force a fixed radius so the validity cue reads as a square in both themes. */
/* Small square status dot: JSON validity readout next to an editor's toolbar. */
.validity-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 0.15rem;
}

/* We provide our own −/+ stepper buttons, so hide the tiny native spinners.
   UInput's real <input> sits inside a wrapper element, not at its own root,
   so scoped CSS needs :deep() to reach past that component boundary. */
:deep(input[type='number']::-webkit-inner-spin-button),
:deep(input[type='number']::-webkit-outer-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}
:deep(input[type='number']) {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* Native datetime-local control sized to sit inline with the sm UInput next to
   it — its own calendar icon is the entire "click to pick" affordance. */
.date-picker-input {
  height: 2rem;
  padding: 0 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  font-size: 0.8125rem;
  color-scheme: light dark;
}

/* Native color swatch control sized to sit inline with the sm UInput next to it. */
.color-picker-input {
  width: 2rem;
  height: 2rem;
  padding: 0.15rem;
  border-radius: 0.375rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
}
</style>
