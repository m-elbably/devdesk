<script setup lang="ts">
import { computed, ref } from 'vue'
import { CopyButton } from '@devdesk/ui'
import TimelineBar from '@/tools/TimelineBar.vue'
import { relativeTime as relative } from '@devdesk/utils'

const props = defineProps<{
  token: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
}>()

type Part = 'header' | 'payload' | 'signature'
// jwt.io's colour language — the same hue marks a segment in the token strip and
// its decoded card, so the two read as one thing without needing a legend.
const PART_COLOR: Record<Part, string> = { header: 'text-error', payload: 'text-primary', signature: 'text-info' }

const hovered = ref<Part | null>(null)
const segments = computed(() => {
  const [h = '', p = '', s = ''] = props.token.trim().split('.')
  return [
    { part: 'header' as const, text: h },
    { part: 'payload' as const, text: p },
    { part: 'signature' as const, text: s },
  ]
})

const CLAIMS: Record<string, string> = {
  iss: 'Issuer — who created the token',
  sub: 'Subject — who the token is about',
  aud: 'Audience — intended recipient',
  exp: 'Expiration time',
  nbf: 'Not before — earliest valid time',
  iat: 'Issued at',
  jti: 'Unique token ID',
  alg: 'Signing algorithm',
  typ: 'Token type',
  kid: 'Key ID — which key signed this',
  cty: 'Content type',
  scope: 'Granted scopes',
  azp: 'Authorized party',
}
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at'])

// Seconds-since-epoch claims are the whole reason people open a JWT parser —
// show the human date inline instead of making them paste it elsewhere.
function timeLabel(key: string, value: unknown): string | null {
  if (!TIME_CLAIMS.has(key) || typeof value !== 'number') return null
  return `${new Date(value * 1000).toLocaleString()} (${relative(value)})`
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// One glanceable verdict: expired / not yet valid / valid, based on exp+nbf.
const status = computed(() => {
  const now = Date.now() / 1000
  const { exp, nbf } = props.payload as { exp?: unknown; nbf?: unknown }
  if (typeof exp === 'number' && exp < now) return { color: 'error' as const, label: `Expired ${relative(exp)}` }
  if (typeof nbf === 'number' && nbf > now) return { color: 'warning' as const, label: `Not valid yet — starts ${relative(nbf)}` }
  if (typeof exp === 'number') return { color: 'success' as const, label: `Expires ${relative(exp)}` }
  return { color: 'neutral' as const, label: 'No expiry claim' }
})

// The lifetime as a bar, when the token carries both ends of one. `nbf` beats
// `iat` as the start: if a token says it isn't valid yet, that is the window.
const lifetime = computed(() => {
  const { exp, nbf, iat } = props.payload as { exp?: unknown; nbf?: unknown; iat?: unknown }
  const start = typeof nbf === 'number' ? nbf : typeof iat === 'number' ? iat : null
  if (start === null || typeof exp !== 'number' || exp <= start) return null
  return {
    from: start * 1000,
    to: exp * 1000,
    fromLabel: typeof nbf === 'number' ? 'Not before' : 'Issued',
    toLabel: 'Expires',
  }
})

const cards = computed(() => [
  { part: 'header' as const, title: 'Header', entries: Object.entries(props.header) },
  { part: 'payload' as const, title: 'Payload', entries: Object.entries(props.payload) },
])
</script>

<template>
  <div class="h-full overflow-auto flex flex-col gap-3">
    <!-- Token strip: hover a segment or a card and the matching half dims/lights up. -->
    <div class="rounded-lg border border-default bg-muted/30 p-3 font-mono text-xs break-all leading-relaxed">
      <template v-for="(s, i) in segments" :key="s.part">
        <span v-if="i" class="text-default/40">.</span>
        <span
          :class="[PART_COLOR[s.part], hovered && hovered !== s.part ? 'opacity-30' : '', hovered === s.part ? 'bg-elevated rounded-sm' : '']"
          class="transition-opacity"
          @mouseenter="hovered = s.part"
          @mouseleave="hovered = null"
        >{{ s.text }}</span>
      </template>
    </div>

    <TimelineBar v-if="lifetime" v-bind="lifetime" />

    <div
      v-for="c in cards"
      :key="c.part"
      class="rounded-lg border border-default overflow-hidden transition-opacity"
      :class="hovered && hovered !== c.part ? 'opacity-50' : ''"
      @mouseenter="hovered = c.part"
      @mouseleave="hovered = null"
    >
      <div class="flex items-center gap-2 px-3 py-2 bg-muted/40 text-sm font-medium" :class="PART_COLOR[c.part]">
        {{ c.title }}
        <UBadge v-if="c.part === 'payload'" :color="status.color" variant="soft" size="sm">{{ status.label }}</UBadge>
      </div>
      <table class="w-full text-sm">
        <tbody class="divide-y divide-muted">
          <tr v-for="[k, v] in c.entries" :key="k">
            <td class="px-3 py-2 align-top whitespace-nowrap font-medium" :title="CLAIMS[k]">
              {{ k }}
              <span v-if="CLAIMS[k]" class="block text-xs font-normal text-default/50">{{ CLAIMS[k] }}</span>
            </td>
            <td class="px-3 py-2 font-mono break-all align-top">
              {{ display(v) }}
              <span v-if="timeLabel(k, v)" class="block text-xs font-sans text-default/60">{{ timeLabel(k, v) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      class="rounded-lg border border-default overflow-hidden transition-opacity"
      :class="hovered && hovered !== 'signature' ? 'opacity-50' : ''"
      @mouseenter="hovered = 'signature'"
      @mouseleave="hovered = null"
    >
      <div class="flex items-center justify-between px-3 py-2 bg-muted/40 text-sm font-medium" :class="PART_COLOR.signature">
        <span>Signature <span class="text-default/50 font-normal">— shown as-is, not verified</span></span>
        <CopyButton :value="signature" />
      </div>
      <p class="px-3 py-2 font-mono text-sm break-all">{{ signature }}</p>
    </div>
  </div>
</template>
