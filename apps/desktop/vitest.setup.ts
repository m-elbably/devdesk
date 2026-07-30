import 'fake-indexeddb/auto' // provides IndexedDB so Dexie-backed repos/services work in tests

// jsdom doesn't implement matchMedia; provide a minimal stub for components that read it.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })) as typeof window.matchMedia
}

// jsdom leaves native dialog and selection geometry unimplemented.
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}
Range.prototype.getClientRects ??= (() => []) as typeof Range.prototype.getClientRects
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as typeof Range.prototype.getBoundingClientRect
