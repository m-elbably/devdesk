import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    {
      // @nuxt/icon's runtime imports a few Nuxt-only composables from `#imports`
      // that Nuxt UI's stub doesn't provide. Must come before ui() so this
      // pre-enforced resolveId wins over the plugin's stub resolution.
      name: 'devdesk:nuxt-imports-shim',
      enforce: 'pre',
      resolveId(id) {
        if (id === '#imports') {
          return fileURLToPath(new URL('./src/shims/nuxt-imports.ts', import.meta.url))
        }
      },
    },
    ui({
      // We use @tanstack/vue-router, not vue-router — Nuxt UI links render as plain anchors.
      router: false,
      // (No `fonts` option here: the Vite plugin has no font handling at all —
      // that's Nuxt-module-only — so the app is already offline-clean.)
      ui: {
        colors: {
          primary: 'blue',
          neutral: 'neutral',
        },
      },
      icon: {
        clientBundle: {
          // Scan sources for i-lucide-* names and bundle the used icons locally
          // (no Iconify CDN requests at runtime). The scan only covers this app's
          // root, so icons used inside @devdesk/ui are listed explicitly.
          scan: true,
          icons: [
            'i-lucide-check',
            'i-lucide-copy',
            'i-lucide-loader-circle',
            'i-lucide-triangle-alert',
            'i-lucide-x',
          ],
        },
      },
    }),
  ],
  // Neutralino loads the built app from ./resources over the file:// origin,
  // so assets must be referenced relatively.
  base: './',
  resolve: {
    // @devdesk/ui depends on @nuxt/ui too, so pnpm gives it a second physical copy.
    // Nuxt UI's plugin only swaps its Vue-compatible <UIcon> into importers under
    // *its own* runtime dir, so icons in @devdesk/ui components (CopyButton, the
    // modal close button) fell back to @nuxt/icon's Nuxt-only CSS mode and rendered
    // blank. One copy = one runtime dir = the override applies everywhere.
    dedupe: ['@nuxt/ui'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @nuxt/icon's runtime expects the Nuxt-module build artifact; Nuxt UI's
      // vite plugin generates the equivalent virtual module.
      '#build/nuxt-icon-client-bundle': 'virtual:nuxt-ui-icons',
    },
  },
  optimizeDeps: {
    // @nuxt/icon's runtime imports '#imports' and '#build/nuxt-icon-client-bundle',
    // which only resolve through the plugin/alias pipeline above. Vite's esbuild
    // prebundler doesn't run that pipeline, so dev would fail to start unless this
    // dep is left out of optimization and served through the normal plugin path.
    exclude: ['@nuxt/icon'],
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    server: {
      // @nuxt/icon's runtime imports '#imports', which only resolves through the
      // shim plugin above. Externalized deps bypass Vite's resolution, so inline it.
      deps: { inline: [/@nuxt\/icon/] },
    },
  },
})
