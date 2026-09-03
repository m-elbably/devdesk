import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Whether the assistant panel is docked open.
 *
 * Deliberately in its own module, importing nothing: `AppLayout` needs the flag to
 * decide whether to mount the panel, and the panel pulls in the AI SDK. If the flag
 * lived inside the panel, importing it would drag ~340 KB of SDK into the startup
 * chunk for an app the user may never ask a question in.
 */
export const assistantOpen = ref(false)

const OPEN_EVENT = 'devdesk:open-assistant'

export const openAssistant = (): void => {
  assistantOpen.value = true
}

export const toggleAssistant = (): void => {
  assistantOpen.value = !assistantOpen.value
}

/** Ctrl/Cmd+I, mirroring how CommandPalette registers its own shortcut. */
export function useAssistantShortcut(): void {
  function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      toggleAssistant()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener(OPEN_EVENT, openAssistant)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener(OPEN_EVENT, openAssistant)
  })
}
