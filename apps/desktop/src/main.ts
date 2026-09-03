import { createApp, defineComponent, type PropType } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import ui from '@nuxt/ui/vue-plugin'
import { registerBuiltinTools } from '@devdesk/tools'
import App from './App.vue'
import { router } from './router'
import { services } from './services'
import { reloadWorkspaces } from './services/workspace'
import { startSync } from './services/sync'
import { initDesktop } from './services/desktop'
import { bus } from './lib/events'
import { migrateLegacySnippets } from './lib/snippetMigration'
import 'katex/dist/katex.min.css'
import './style.css'

// Suppress the native webview's right-click menu everywhere (reload/back/etc. have
// no place in the app); on text fields, open our own Copy/Paste/Delete/Select All
// menu instead (see EditContextMenu.vue) rather than the OS's full edit menu.
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement
  // Elements marked [data-context-menu] bring their own menu (Reka's UContextMenu).
  // It re-reads defaultPrevented a microtask after the event and bails if the flag
  // is set, so cancelling here would silently swallow every such menu. It calls
  // preventDefault itself, which still beats the native menu.
  if (target.closest('[data-context-menu]')) return
  e.preventDefault()
  const el = target.closest('input, textarea, [contenteditable="true"]')
  if (el) bus.emit('edit-menu:open', { x: e.clientX, y: e.clientY, target: el as HTMLElement })
})

// Populate the tool registry, init native runtime, ensure the default workspace exists.
registerBuiltinTools()
void initDesktop()
void services.bootstrap().then(() => migrateLegacySnippets()).then(reloadWorkspaces)
startSync()

const app = createApp(App).use(VueQueryPlugin).use(ui)

// Nuxt UI's ULink resolves <NuxtLink> for internal `to` links. Nothing provides
// it outside Nuxt, and the resolution is hoisted out of its v-if, so every
// UButton render warns even though the branch is dead here (all real navigation
// goes through @tanstack/vue-router's own Link). Satisfy ULink's custom-slot
// contract so the warning goes and a stray `to` still navigates.
app.component('NuxtLink', defineComponent({
  props: { to: { type: [String, Object] as PropType<string | object>, default: '' } },
  setup(props, { slots }) {
    const href = () => (typeof props.to === 'string' ? props.to : '')
    return () =>
      slots.default?.({
        href: href(),
        navigate: (e?: Event) => {
          e?.preventDefault()
          void router.navigate({ to: href() as never })
        },
        route: { path: href(), query: {}, hash: '' },
        isActive: false,
        isExactActive: false,
      })
  },
}))

app.mount('#app')

// Hold the workspace-switch splash (see index.html) a beat so the swap reads as
// deliberate loading rather than a flicker.
const switchedAt = Number(sessionStorage.getItem('devdesk.switching'))
if (switchedAt) {
  sessionStorage.removeItem('devdesk.switching')
  setTimeout(
    () => document.getElementById('switch-overlay')?.remove(),
    Math.max(0, 400 - (Date.now() - switchedAt)),
  )
}
