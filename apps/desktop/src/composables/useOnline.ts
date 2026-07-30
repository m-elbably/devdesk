import { ref, onMounted, onUnmounted } from 'vue'

/** Reactive online/offline flag driven by the browser's network events. */
export function useOnline() {
  const online = ref(navigator.onLine)
  const set = () => (online.value = navigator.onLine)
  onMounted(() => {
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
  })
  onUnmounted(() => {
    window.removeEventListener('online', set)
    window.removeEventListener('offline', set)
  })
  return { online }
}
