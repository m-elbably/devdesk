// Supplements Nuxt UI's `#imports` stub with the Nuxt-only composables that
// @nuxt/icon's runtime imports at module level. They are inert here:
// onServerPrefetch/useAsyncData only matter during SSR, which never runs in
// this client-only app.
export * from '@nuxt/ui/runtime/vue/stubs/none.js'

export { defineComponent } from 'vue'

export function onServerPrefetch(_callback: unknown) {
  // SSR-only; no-op on the client.
}

export function useAsyncData(..._args: unknown[]) {
  // SSR-only; never called on the client (guarded by import.meta.server).
  return { data: { value: null } }
}
