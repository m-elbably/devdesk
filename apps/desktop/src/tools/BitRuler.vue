<script setup lang="ts">
import { computed } from 'vue'

// The 32 bits of an IPv4 address, grouped by octet. For a CIDR the network bits
// are coloured apart from the host bits, which is the whole reason /26 vs /27 is
// hard to reason about from the dotted form alone.
const props = defineProps<{ address: string; prefix?: number }>()

const value = computed(() => {
  const parts = props.address.trim().split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ? null
    : nums.reduce((ip, n) => ip * 256 + n, 0)
})

const octets = computed(() => {
  if (value.value === null) return []
  const bits = value.value.toString(2).padStart(32, '0')
  return [0, 1, 2, 3].map((o) => ({
    decimal: (value.value! >>> (24 - o * 8)) & 255,
    bits: [...bits.slice(o * 8, o * 8 + 8)].map((bit, i) => ({
      bit,
      index: o * 8 + i,
      // No prefix (plain address conversion) means no network/host split to show.
      network: props.prefix !== undefined && o * 8 + i < props.prefix,
    })),
  }))
})

const hostBits = computed(() => (props.prefix === undefined ? null : 32 - props.prefix))
const summary = computed(() =>
  hostBits.value === null
    ? null
    : `${props.prefix} network bits · ${hostBits.value} host bits · ${(2 ** hostBits.value).toLocaleString('en-US')} addresses`,
)
</script>

<template>
  <div v-if="octets.length" class="rounded-lg border border-default bg-muted/30 px-4 py-3">
    <div class="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div v-for="(octet, o) in octets" :key="o" class="flex flex-col items-center gap-1">
        <div class="flex gap-px">
          <span
            v-for="b in octet.bits"
            :key="b.index"
            class="flex size-4 items-center justify-center rounded-[2px] font-mono text-[10px] leading-none"
            :class="b.network ? 'bg-primary text-inverted' : b.bit === '1' ? 'bg-elevated text-default' : 'bg-muted text-default/40'"
            :title="`Bit ${b.index}${prefix === undefined ? '' : b.network ? ' — network' : ' — host'}`"
          >{{ b.bit }}</span>
        </div>
        <span class="font-mono text-xs tabular-nums text-default/60">{{ octet.decimal }}</span>
      </div>
    </div>
    <p v-if="summary" class="mt-2 text-xs text-default/60">{{ summary }}</p>
  </div>
</template>
