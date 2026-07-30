<script setup lang="ts">
import { computed } from 'vue'

// A proportional map of the address blocks in the result table. Splitting a /16
// into /20s is easy to read as a list; seeing that the blocks tile the parent
// exactly — or that one block in a summarised range is 128× the others — is not.
//
// Blocks are read out of the key/value result rather than passed in, matching
// how the other visuals work: a tool opts in with one `visual: 'subnets'` line.
const props = defineProps<{ entries: [string, unknown][] }>()

const CIDR = /(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})/

const blocks = computed(() => {
  const found = props.entries.flatMap(([label, value]) => {
    const match = CIDR.exec(String(value))
    if (!match) return []
    const network = match[1]!.split('.').reduce((ip, o) => ip * 256 + Number(o), 0)
    const prefix = Number(match[2])
    return [{ label, cidr: `${match[1]}/${prefix}`, network, size: 2 ** (32 - prefix) }]
  })
  // One block is just the input echoed back — nothing to compare it against.
  return found.length > 1 ? found.sort((a, b) => a.network - b.network) : []
})

const span = computed(() => {
  const first = blocks.value[0]!
  const last = blocks.value[blocks.value.length - 1]!
  return { from: first.network, to: last.network + last.size - 1 }
})

const format = (ip: number) => [24, 16, 8, 0].map((s) => (ip >>> s) & 255).join('.')

// Enough hues to tell neighbours apart without inventing a palette; the ramp
// repeats past six blocks, which is fine because adjacency is what matters.
const HUES = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-secondary', 'bg-error']

// Gaps between blocks are as informative as the blocks — an unallocated hole in
// a plan, or proof that a summarised range tiles with nothing left over.
const segments = computed(() =>
  blocks.value.flatMap((block, i) => {
    const previous = blocks.value[i - 1]
    const gapSize = previous ? block.network - (previous.network + previous.size) : 0
    const gap = gapSize > 0 ? [{ gap: true as const, size: gapSize, key: `gap-${i}` }] : []
    return [...gap, { gap: false as const, ...block, key: block.cidr, hue: HUES[i % HUES.length]! }]
  }),
)

const total = computed(() => span.value.to - span.value.from + 1)
const share = (size: number) => (size / total.value) * 100
</script>

<template>
  <div v-if="blocks.length" class="rounded-lg border border-default bg-muted/30 px-4 py-3">
    <div class="flex h-7 w-full gap-px overflow-hidden rounded">
      <div
        v-for="segment in segments"
        :key="segment.key"
        class="flex min-w-[3px] items-center justify-center overflow-hidden"
        :class="segment.gap ? 'bg-muted border border-dashed border-default' : `${segment.hue} text-inverted`"
        :style="{ flex: `${Math.max(share(segment.size), 0.2)} 1 0%` }"
        :title="
          segment.gap
            ? `Unallocated — ${segment.size.toLocaleString('en-US')} addresses`
            : `${segment.label}: ${segment.cidr} — ${segment.size.toLocaleString('en-US')} addresses (${share(segment.size).toFixed(1)}%)`
        "
      >
        <span v-if="!segment.gap && share(segment.size) > 8" class="truncate px-1 font-mono text-[10px] leading-none">
          /{{ segment.cidr.split('/')[1] }}
        </span>
      </div>
    </div>
    <div class="mt-1.5 flex items-center justify-between font-mono text-[11px] text-default/50">
      <span>{{ format(span.from) }}</span>
      <span class="font-sans text-default/60">
        {{ blocks.length }} blocks · {{ total.toLocaleString('en-US') }} addresses
      </span>
      <span>{{ format(span.to) }}</span>
    </div>
  </div>
</template>
