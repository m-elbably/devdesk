<script setup lang="ts">
import { computed } from 'vue'

// The permission matrix as something you can click, not just read. Emits a
// symbolic mode because the plugin already parses that form, so the grid and
// the text field stay one source of truth.
const props = defineProps<{ symbolic: string }>()
const emit = defineEmits<{ update: [mode: string] }>()

const CLASSES = ['Owner', 'Group', 'Other'] as const
const SLOTS = ['r', 'w', 'x'] as const
// setuid/setgid/sticky live in the execute slot: s/t mean the special bit is set
// with execute on, S/T with it off. Toggling execute has to preserve that.
const EXEC_ON: Record<string, string> = { '-': 'x', S: 's', T: 't' }
const EXEC_OFF: Record<string, string> = { x: '-', s: 'S', t: 'T' }

const valid = computed(() => /^[rwxsStT-]{9}$/.test(props.symbolic))
const rows = computed(() =>
  CLASSES.map((name, t) => ({
    name,
    slots: SLOTS.map((slot, s) => {
      const char = props.symbolic[t * 3 + s] ?? '-'
      return { slot, char, on: slot === 'x' ? char in EXEC_OFF : char === slot }
    }),
  })),
)

function toggle(t: number, s: number) {
  const chars = [...props.symbolic]
  const i = t * 3 + s
  const char = chars[i] ?? '-'
  chars[i] = s === 2 ? (EXEC_OFF[char] ?? EXEC_ON[char] ?? 'x') : char === '-' ? SLOTS[s]! : '-'
  emit('update', chars.join(''))
}
</script>

<template>
  <div v-if="valid" class="inline-block rounded-lg border border-default bg-muted/30 p-3">
    <table class="text-sm">
      <thead>
        <tr class="text-xs text-default/60">
          <th />
          <th v-for="slot in SLOTS" :key="slot" class="px-3 pb-1 font-medium">
            {{ { r: 'Read', w: 'Write', x: 'Execute' }[slot] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, t) in rows" :key="row.name">
          <th class="pr-3 text-right text-xs font-medium text-default/60">{{ row.name }}</th>
          <td v-for="(cell, s) in row.slots" :key="cell.slot" class="px-3 py-1 text-center">
            <UCheckbox
              :model-value="cell.on"
              :aria-label="`${row.name} ${cell.slot}`"
              :title="`${row.name}: ${cell.char}`"
              @update:model-value="toggle(t, s)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
