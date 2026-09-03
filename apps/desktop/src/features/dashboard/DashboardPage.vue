<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { Link } from '@tanstack/vue-router'
import { AlertTriangle, Calendar, CheckCircle2, Loader, StickyNote } from 'lucide-vue-next'
import type { Note, Task, ToolDefinition } from '@devdesk/shared'
import { BOARD_COLUMNS } from '@devdesk/shared'
import { getActiveWorkspaceId } from '@devdesk/database'
import { getTool } from '@devdesk/tools'
import { EmptyState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import ToolCard from '@/features/tools/ToolCard.vue'
import { services } from '@/services'
import { bus } from '@/lib/events'
import { PRIMARY_NAV } from '@/lib/navigation'

const quickLinks = PRIMARY_NAV.items.filter((i) => i.to !== '/')

// PageShell's `icon` slot takes a component; the app icon is a public/ asset, so
// wrap it rather than adding an image-only prop.
// ponytail: inline width/height rather than an `iconClass` prop for one caller —
// PageShell hardcodes size-6 on the icon, and a second size-* utility would win
// or lose by stylesheet order, not by being listed here.
const AppIcon = () =>
  h('img', { src: './icon.png', alt: '', class: 'rounded-xl', style: 'width:3.5rem;height:3.5rem' })

const tasks = ref<Task[]>([])
const notes = ref<Note[]>([])
const recentTools = ref<ToolDefinition[]>([])

async function reload() {
  const [t, n, r] = await Promise.all([
    services.tasks.byWorkspace(getActiveWorkspaceId()),
    services.notes.list(),
    services.preferences.recent.list(),
  ])
  tasks.value = t
  notes.value = n
  recentTools.value = r.map((x) => getTool(x.toolId)).filter((x): x is ToolDefinition => !!x).slice(0, 3)
}

const offs: (() => void)[] = []
onMounted(() => {
  void reload()
  offs.push(bus.on('entity:mutated', () => reload()), bus.on('tool:opened', () => reload()))
})
onUnmounted(() => offs.forEach((off) => off()))

const startOfToday = () => new Date().setHours(0, 0, 0, 0)
const open = computed(() => tasks.value.filter((t) => t.status !== 'done'))
const overdue = computed(() => open.value.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < startOfToday()))

const stats = computed(() => [
  { label: 'In progress', value: tasks.value.filter((t) => t.status === 'in_progress').length, icon: Loader, to: '/board', tone: 'text-primary' },
  { label: 'Overdue', value: overdue.value.length, icon: AlertTriangle, to: '/board', tone: overdue.value.length ? 'text-error' : 'text-default/40' },
  { label: 'Notes', value: notes.value.length, icon: StickyNote, to: '/notes', tone: 'text-default/60' },
])

// `info` resolves to the same blue as `primary` in this app's palette, so the
// strip picks four visibly distinct hues instead of the semantic tokens.
const COLUMN_COLOR: Record<string, string> = {
  backlog: 'bg-inverted/25',
  todo: 'bg-warning',
  in_progress: 'bg-primary',
  done: 'bg-success',
}

/**
 * Task column counts + share of total, for the progress strip.
 * ponytail: segments are plain inline-block %-width spans — no width transition,
 * so the bar can never get stuck mid-animation at zero width.
 */
const progress = computed(() => {
  const total = tasks.value.length || 1
  return BOARD_COLUMNS.map((c) => {
    const count = tasks.value.filter((t) => t.status === c.status).length
    return { ...c, count, color: COLUMN_COLOR[c.status], pct: (count / total) * 100 }
  })
})

const doneCount = computed(() => tasks.value.filter((t) => t.status === 'done').length)

/** Overdue first, then nearest due date; undated tasks are not "focus". */
const focus = computed(() =>
  open.value
    .filter((t) => t.dueDate)
    .sort((a, b) => Date.parse(a.dueDate!) - Date.parse(b.dueDate!))
    .slice(0, 5),
)

function dueLabel(iso: string): string {
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - startOfToday()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${-days}d overdue`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <PageShell title="Dashboard" subtitle="Your local-first developer toolbox" :icon="AppIcon">
    <div class="flex flex-col gap-6">
      <!-- Counters -->
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Link
          v-for="s in stats"
          :key="s.label"
          :to="s.to"
          class="rounded-lg border border-default bg-default p-4 hover:border-primary transition-colors"
        >
          <div class="flex items-center gap-2 text-sm text-default/60">
            <component :is="s.icon" class="size-4" :class="s.tone" />{{ s.label }}
          </div>
          <div class="mt-1 text-2xl font-bold" :class="s.tone">{{ s.value }}</div>
        </Link>
      </div>

      <!-- Task progress -->
      <section class="rounded-lg border border-default bg-default p-4">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="font-medium">Tasks</h2>
          <span class="text-sm text-default/60">
            <CheckCircle2 class="inline size-4 mr-1 text-success" />{{ doneCount }} / {{ tasks.length }} done
          </span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-elevated ring-1 ring-default text-[0px] leading-none">
          <span
            v-for="c in progress"
            :key="c.status"
            class="inline-block h-full align-top"
            :class="c.color"
            :style="{ width: `${c.pct}%` }"
          />
        </div>
        <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-default/60">
          <span v-for="c in progress" :key="c.status" class="inline-flex items-center gap-1.5">
            <span class="size-2 rounded-full" :class="c.color" />
            {{ c.label }} <b class="text-default">{{ c.count }}</b>
          </span>
        </div>
      </section>

      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Upcoming / overdue -->
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-medium">Up next</h2>
            <Link to="/board" class="text-sm text-primary hover:underline">Open tasks</Link>
          </div>
          <div v-if="focus.length" class="flex flex-col gap-2">
            <Link
              v-for="t in focus"
              :key="t.id"
              to="/board"
              class="flex items-center gap-3 rounded-lg border border-default bg-default px-3 py-2 hover:border-primary transition-colors"
            >
              <span class="truncate flex-1 text-sm">{{ t.title }}</span>
              <UBadge :color="t.priority === 'urgent' ? 'error' : t.priority === 'high' ? 'warning' : 'neutral'" variant="soft" size="sm">
                {{ t.priority }}
              </UBadge>
              <span
                class="inline-flex items-center gap-1 text-xs shrink-0"
                :class="Date.parse(t.dueDate!) < startOfToday() ? 'text-error' : 'text-default/50'"
              >
                <Calendar class="size-3" />{{ dueLabel(t.dueDate!) }}
              </span>
            </Link>
          </div>
          <EmptyState v-else title="Nothing scheduled" description="Tasks with a due date show up here." />
        </section>

        <!-- Recent tools -->
        <section v-if="recentTools.length">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-medium">Recent tools</h2>
            <Link to="/recent" class="text-sm text-primary hover:underline">See all</Link>
          </div>
          <div class="flex flex-col gap-2">
            <ToolCard v-for="tool in recentTools" :key="tool.id" :tool="tool" />
          </div>
        </section>
      </div>

      <!-- Quick links -->
      <section>
        <h2 class="font-medium mb-3">Jump to</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            class="rounded-lg border border-default bg-default hover:border-primary transition-colors"
          >
            <div class="flex items-center gap-3 p-4">
              <component :is="link.icon" class="size-6 text-primary" />
              <span class="font-medium text-default">{{ link.label }}</span>
            </div>
          </Link>
        </div>
      </section>
    </div>
  </PageShell>
</template>
