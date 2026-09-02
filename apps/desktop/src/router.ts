import { defineAsyncComponent } from 'vue'
import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
} from '@tanstack/vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import DashboardPage from '@/features/dashboard/DashboardPage.vue'

// Hash history: the packaged Neutralino app is served from file://, where the
// browser's path-based history would break on reload/deep-link.
const rootRoute = createRootRoute({ component: AppLayout })

// Dashboard is the landing view → eager. Everything else is lazy so heavy deps
// (vuedraggable, marked, highlight.js, qrcode) load only when their route is opened.
const lazy = (loader: () => Promise<unknown>) => defineAsyncComponent(loader as never)

const route = (path: string, component: unknown) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: component as never })

const routes = [
  route('/', DashboardPage),
  route('/workspace', lazy(() => import('@/features/workspace/WorkspaceHomePage.vue'))),
  route('/board', lazy(() => import('@/features/board/BoardPage.vue'))),
  route('/notes', lazy(() => import('@/features/notes/NotesPage.vue'))),
  route('/snippets', lazy(() => import('@/features/snippets/SnippetsPage.vue'))),
  route('/favorites', lazy(() => import('@/features/favorites/FavoritesPage.vue'))),
  route('/recent', lazy(() => import('@/features/recent/RecentPage.vue'))),
  route('/settings', lazy(() => import('@/features/settings/SettingsPage.vue'))),
  route('/admin/users', lazy(() => import('@/features/admin/UsersPage.vue'))),
  route('/tools/$category', lazy(() => import('@/features/tools/ToolCategoryPage.vue'))),
  route('/tools/$category/$toolId', lazy(() => import('@/features/tools/ToolPage.vue'))),
]

const routeTree = rootRoute.addChildren(routes)

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module '@tanstack/vue-router' {
  interface Register {
    router: typeof router
  }
}
