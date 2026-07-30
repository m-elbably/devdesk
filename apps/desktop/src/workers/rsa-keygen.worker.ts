// Runs RSA key generation off the main thread. crypto.subtle.generateKey is
// nominally async, but this app's WebView crypto backend doesn't reliably yield
// control back to the render thread for large moduli — without this the whole
// window hangs while a big key is generated. Cast `self` instead of pulling in
// the "webworker" lib, which conflicts with this project's "dom" lib.
import { rsaKeyPairTool } from '@devdesk/tools'

type Request = { bits: number }
type Response = { ok: true; result: { publicKey: string; privateKey: string } } | { ok: false; error: string }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage: (msg: Response) => void
}

ctx.onmessage = async (e) => {
  try {
    const result = (await rsaKeyPairTool.run({ bits: e.data.bits })) as { publicKey: string; privateKey: string }
    ctx.postMessage({ ok: true, result })
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
