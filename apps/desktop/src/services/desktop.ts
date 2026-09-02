/**
 * Native integration behind an adapter. Components call `desktop.*`, never Neutralino
 * directly — so the same code runs in the packaged desktop app and in a plain browser.
 * Requirement: Vue → DesktopService → NeutralinoAdapter.
 */
/** What the open dialog should accept. Native wants extensions, the web wants an accept string. */
export interface FileFilter {
  name: string
  extensions: string[]
}

const JSON_FILTER: FileFilter = { name: 'JSON', extensions: ['json'] }

export interface DesktopAdapter {
  readonly isNative: boolean
  saveTextFile(filename: string, content: string): Promise<void>
  /** Prompt the user to pick a file and return its text contents, or null if cancelled. */
  openTextFile(filter?: FileFilter): Promise<string | null>
  readClipboard(): Promise<string>
  copyToClipboard(text: string): Promise<void>
  setWindowTitle(title: string): Promise<void>
  /** Open a URL in the system's default browser (not the app's webview). */
  openExternal(url: string): Promise<void>
}

/** Browser fallback: download via a blob, Web Clipboard API, document.title. */
class WebAdapter implements DesktopAdapter {
  readonly isNative = false

  async saveTextFile(filename: string, content: string): Promise<void> {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async openTextFile(filter: FileFilter = JSON_FILTER): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = filter.extensions.map((e) => `.${e}`).join(',')
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => resolve(null)
        reader.readAsText(file)
      }
      input.click()
    })
  }

  async copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text)
  }

  async readClipboard(): Promise<string> {
    return navigator.clipboard.readText()
  }

  async setWindowTitle(title: string): Promise<void> {
    document.title = title
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** Neutralino-backed adapter. Native modules are imported lazily so web builds never load them. */
class NeutralinoAdapter implements DesktopAdapter {
  readonly isNative = true

  async saveTextFile(filename: string, content: string): Promise<void> {
    const { os, filesystem } = await import('@neutralinojs/lib')
    const path = await os.showSaveDialog('Save file', { defaultPath: filename })
    if (path) await filesystem.writeFile(path, content)
  }

  async openTextFile(filter: FileFilter = JSON_FILTER): Promise<string | null> {
    const { os, filesystem } = await import('@neutralinojs/lib')
    const path = await os.showOpenDialog('Open file', { filters: [filter] })
    const file = Array.isArray(path) ? path[0] : path
    if (!file) return null
    return filesystem.readFile(file)
  }

  async copyToClipboard(text: string): Promise<void> {
    const { clipboard } = await import('@neutralinojs/lib')
    await clipboard.writeText(text)
  }

  async readClipboard(): Promise<string> {
    const { clipboard } = await import('@neutralinojs/lib')
    return clipboard.readText()
  }

  async setWindowTitle(title: string): Promise<void> {
    const { window: neuWindow } = await import('@neutralinojs/lib')
    await neuWindow.setTitle(title)
  }

  async openExternal(url: string): Promise<void> {
    const Neutralino = await import('@neutralinojs/lib')
    await Neutralino.os.open(url)
  }
}

// Neutralino injects NL_PORT into the global scope; its absence means we're on the web.
const isNeutralino = typeof (globalThis as { NL_PORT?: number }).NL_PORT !== 'undefined'

export const desktop: DesktopAdapter = isNeutralino ? new NeutralinoAdapter() : new WebAdapter()

/** Initialize the native runtime (no-op on web). Call once at startup. */
export async function initDesktop(): Promise<void> {
  if (!isNeutralino) return
  const Neutralino = await import('@neutralinojs/lib')
  Neutralino.init()
}
