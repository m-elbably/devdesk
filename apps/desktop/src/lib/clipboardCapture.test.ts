import { describe, expect, it } from 'vitest'
import { suggestClipboardCapture } from './clipboardCapture'

describe('suggestClipboardCapture', () => {
  it('routes common clipboard formats to the matching tool', () => {
    expect(suggestClipboardCapture('https://example.com/a?b=c')).toMatchObject({ kind: 'task', path: '/tools/web/url-parser' })
    expect(suggestClipboardCapture('curl https://example.com')).toMatchObject({ kind: 'snippet', path: '/tools/web/curl' })
    expect(suggestClipboardCapture('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature')).toMatchObject({ kind: 'snippet', path: '/tools/crypto/jwt' })
  })
})
