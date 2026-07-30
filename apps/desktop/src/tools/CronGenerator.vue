<script setup lang="ts">
import { computed, ref } from 'vue'
import { CRON_FIELDS, describeCron, nextCronRuns, parseCronField } from '@devdesk/tools'
import { relativeTime } from '@devdesk/utils'
import { CopyButton } from '@devdesk/ui'

const PRESETS = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 15 min', expression: '*/15 * * * *' },
  { label: 'Hourly', expression: '0 * * * *' },
  { label: 'Daily at midnight', expression: '0 0 * * *' },
  { label: 'Weekdays 9am', expression: '0 9 * * 1-5' },
  { label: 'Weekly (Sun)', expression: '0 0 * * 0' },
  { label: 'Monthly', expression: '0 0 1 * *' },
  { label: 'Yearly', expression: '0 0 1 1 *' },
]

// Per-field hints, since "what can I even type here" is the actual friction in
// writing cron by hand.
const HINTS: Record<string, string> = {
  minute: '0–59',
  hour: '0–23',
  dayOfMonth: '1–31',
  month: '1–12 or JAN–DEC',
  dayOfWeek: '0–6 or SUN–SAT',
}

// The expression is the single source of truth; the five field inputs are just
// views onto its parts, so editing either side stays in sync for free.
const expression = ref('0 9 * * 1-5')
const parts = computed(() => {
  const split = expression.value.trim().split(/\s+/)
  return CRON_FIELDS.map((_, i) => split[i] ?? '')
})
function setPart(i: number, value: string) {
  const next = [...parts.value]
  next[i] = value.trim() || '*'
  expression.value = next.slice(0, CRON_FIELDS.length).join(' ')
}

// Per-field errors let the UI point at the field that's wrong instead of
// showing one opaque "invalid expression".
const fieldErrors = computed(() =>
  CRON_FIELDS.map((f, i) => {
    const raw = parts.value[i]
    if (!raw) return 'required'
    try {
      parseCronField(raw, f.min, f.max)
      return ''
    } catch (e) {
      return e instanceof Error ? e.message : 'invalid'
    }
  }),
)

const parsed = computed(() => {
  try {
    return { description: describeCron(expression.value), runs: nextCronRuns(expression.value, 5), error: '' }
  } catch (e) {
    return { description: '', runs: [], error: e instanceof Error ? e.message : String(e) }
  }
})

const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
</script>

<template>
  <div class="flex flex-col h-full min-h-0 gap-4 overflow-auto">
    <!-- Expression: full width at the top, the thing you copy -->
    <div class="shrink-0">
      <div
        class="flex items-center gap-2 rounded-lg border bg-default px-4 py-3 transition-colors"
        :class="parsed.error ? 'border-error' : 'border-default focus-within:border-primary'"
      >
        <input
          v-model="expression"
          class="flex-1 min-w-0 bg-transparent font-mono text-2xl tracking-wider outline-none placeholder:text-default/30"
          placeholder="* * * * *"
          spellcheck="false"
          aria-label="Cron expression"
        />
        <CopyButton :value="expression" />
      </div>
      <p v-if="parsed.error" class="mt-1.5 text-sm text-error">{{ parsed.error }}</p>
      <p v-else class="mt-1.5 text-sm text-default">{{ parsed.description }}</p>
    </div>

    <!-- Field builders, in the same left-to-right order as the expression -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
      <div v-for="(f, i) in CRON_FIELDS" :key="f.key" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-default/60" :for="`cron-${f.key}`">{{ f.label }}</label>
        <UInput
          :id="`cron-${f.key}`"
          :model-value="parts[i]"
          size="sm"
          class="font-mono"
          :color="fieldErrors[i] ? 'error' : undefined"
          :ui="{ base: 'font-mono' }"
          @update:model-value="setPart(i, String($event))"
        />
        <span class="text-xs" :class="fieldErrors[i] ? 'text-error' : 'text-default/40'">
          {{ fieldErrors[i] || HINTS[f.key] }}
        </span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 shrink-0">
      <span class="text-xs text-default/50 mr-0.5">Presets</span>
      <UButton
        v-for="p in PRESETS"
        :key="p.label"
        color="neutral"
        :variant="expression.trim() === p.expression ? 'solid' : 'soft'"
        size="xs"
        @click="expression = p.expression"
      >
        {{ p.label }}
      </UButton>
    </div>

    <!-- Next runs: the check that the expression means what you think it means -->
    <div class="flex flex-col min-h-0">
      <div class="flex items-center justify-between h-7 shrink-0">
        <span class="text-sm font-medium text-default/60">Next runs</span>
        <span class="text-xs text-default/40">{{ timeZone }}</span>
      </div>
      <div class="mt-1.5 rounded-lg border border-default bg-default overflow-hidden">
        <ul v-if="parsed.runs.length" class="divide-y divide-muted text-sm">
          <li v-for="(run, i) in parsed.runs" :key="i" class="flex items-center justify-between gap-3 px-3 py-2">
            <span class="font-mono">{{ formatter.format(run) }}</span>
            <span class="text-default/50">{{ relativeTime(run.getTime() / 1000) }}</span>
          </li>
        </ul>
        <p v-else class="px-3 py-4 text-sm text-default/50">
          {{ parsed.error ? 'Fix the expression to see when it runs.' : 'This expression never fires — check the day and month fields.' }}
        </p>
      </div>
      <p class="mt-2 text-xs text-default/50">
        Times are in your local time zone. Cron daemons use the server's zone — check it before deploying.
      </p>
    </div>
  </div>
</template>
