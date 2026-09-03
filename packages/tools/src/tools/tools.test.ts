import { describe, it, expect } from 'vitest'
import { jsonDiff, jsonToTs } from './json'
import { base64, urlEncoder, htmlEscape, hexConverter, unicodeInspector, codeEscape } from './encoding'
import forge from 'node-forge'
import { uuidTool, ulidTool, hashTool, hmacTool, totpHotpTool, tokenTool, passwordTool, passwordStrengthTool, jwtParser, jwtSigner, encryptionTool, rsaKeyPairTool, certParser, uuidInspector } from './crypto'
import { urlParser, basicAuth, slugify, userAgent, httpStatus, curlConverter, cookieParser, cacheControl, tokenizeShell } from './web'
import { regexTester, cronGenerator, emailNormalizer, caseConverter, chmodCalculator, parseCronField, nextCronRuns, describeCron } from './development'
import { svgPlaceholder, qrCode, colorPalette, contrastChecker, svgOptimizer, gradientCss, dominantColors, parseColor, rgbToHsl, contrastRatio } from './images'
import { percentage, eta, byteConverter, stats, slaUptime, baseConverter, aspectRatio, transferTime, parseNumbers, percentileOf } from './math'
import { cidrCalculator, ipConverter, subnetSplitter, ipRangeCidr, cidrMatcher, macGenerator, macInspector, portReference } from './networking'
import { jsonYaml, jsonCsv, jsonLines, xmlJson, envJson } from './data-formats'
import { timestampConverter, timezoneConverter, durationCalculator, dateCalculator, isoDuration } from './date-time'
import { colorConverter } from './images'

describe('json tools', () => {
  it('diffs', () => {
    expect(jsonDiff.run({ left: '{"a":1}', right: '{"a":2}' })).toEqual([
      { path: '$.a', kind: 'changed', before: 1, after: 2 },
    ])
    expect(jsonDiff.run({ left: '{"a":1}', right: '{"a":1}' })).toEqual([])
  })
  it('generates typescript', () => {
    const out = jsonToTs.run({ text: '{"id":1,"name":"x","tags":["a"]}', rootName: 'User' }) as string
    expect(out).toContain('interface User')
    expect(out).toContain('id: number')
    expect(out).toContain('tags: string[]')
  })
  it('throws on invalid json', () => {
    expect(() => jsonDiff.run({ left: 'nope', right: '{}' })).toThrow(/Invalid JSON/)
  })
})

describe('json to ts edge cases', () => {
  it('dedupes identically-shaped interfaces', () => {
    const out = jsonToTs.run({
      text: '{"items":[{"id":1,"name":"x"},{"id":2,"name":"y"}]}',
      rootName: 'Root',
    }) as string
    expect(out.match(/interface Item/g)?.length).toBe(1)
    expect(out).toContain('items: Item[]')
  })
  it('handles heterogeneous arrays and root primitives', () => {
    const out = jsonToTs.run({ text: '["a",1,true]', rootName: 'Root' }) as string
    expect(out).toBe('type Root = (string | number | boolean)[]')
  })
  it('merges array element shapes into one interface with optional props', () => {
    const out = jsonToTs.run({
      text: '{"items":[{"id":1},{"id":2,"note":"x"}]}',
      rootName: 'Root',
    }) as string
    expect(out.match(/interface Item/g)?.length).toBe(1)
    expect(out).toContain('id: number')
    expect(out).toContain('note?: string')
  })
  it('unions null with the non-null type', () => {
    const out = jsonToTs.run({
      text: '{"rows":[{"name":"a"},{"name":null}]}',
      rootName: 'Root',
    }) as string
    expect(out).toContain('name: string | null')
  })
  it('sanitizes invalid identifiers and reserved words', () => {
    const out = jsonToTs.run({ text: '{"1key":1,"class":2,"a-b":3}', rootName: 'root' }) as string
    expect(out).toContain('"1key": number')
    expect(out).toContain('"class": number')
    expect(out).toContain('"a-b": number')
  })
})

describe('encoding tools', () => {
  it('round-trips base64 with unicode', () => {
    const enc = base64.run({ text: 'héllo →', mode: 'encode' }) as string
    expect(base64.run({ text: enc, mode: 'decode' })).toBe('héllo →')
  })
  it('url + html', () => {
    expect(urlEncoder.run({ text: 'a b&c', mode: 'encode' })).toBe('a%20b%26c')
    expect(htmlEscape.run({ text: '<a>&"', mode: 'encode' })).toBe('&lt;a&gt;&amp;&quot;')
  })
  it('base64 url-safe alphabet and optional padding', () => {
    const text = '~~~?>>'
    const std = base64.run({ text, mode: 'encode' }) as string
    expect(std).toMatch(/[+/]/)
    const url = base64.run({ text, mode: 'encode', variant: 'url-safe' }) as string
    expect(url).not.toMatch(/[+/]/)
    expect(base64.run({ text, mode: 'encode', variant: 'url-safe', padding: false })).toBe(url.replace(/=+$/, ''))
    // Decoding is variant-agnostic and tolerates missing padding + line breaks.
    for (const v of [std, url, url.replace(/=+$/, ''), `${std.slice(0, 4)}\n${std.slice(4)}`]) {
      expect(base64.run({ text: v, mode: 'decode' })).toBe(text)
    }
  })
  it('base64 rejects non-base64 input with a readable message', () => {
    expect(() => base64.run({ text: 'not base64!!', mode: 'decode' })).toThrow(/valid Base64/)
  })
  it('url encoder variants', () => {
    expect(urlEncoder.run({ text: 'a/b?c d', mode: 'encode', variant: 'full-uri' })).toBe('a/b?c%20d')
    expect(urlEncoder.run({ text: "a b(c)", mode: 'encode', variant: 'form' })).toBe('a+b%28c%29')
    // `+` is a space only in form mode; a literal plus survives elsewhere.
    expect(urlEncoder.run({ text: 'a+b', mode: 'decode', variant: 'form' })).toBe('a b')
    expect(urlEncoder.run({ text: 'a+b', mode: 'decode' })).toBe('a+b')
    expect(() => urlEncoder.run({ text: '%zz', mode: 'decode' })).toThrow(/percent-encoding/)
  })
  it('html decodes named and numeric entities, and escapes non-ascii on request', () => {
    expect(htmlEscape.run({ text: '&nbsp;&#39;&#x3C;&rsquo;&bogus;', mode: 'decode' })).toBe(' \'<’&bogus;')
    // The Latin-1 names are derived positionally from one word list, so spot-check
    // both ends and the middle — an off-by-one there would shift every entity.
    expect(htmlEscape.run({ text: '&Agrave;&eacute;&ccedil;&uuml;&yuml;&copy;&pound;&times;', mode: 'decode' }))
      .toBe('Àéçüÿ©£×')
    expect(htmlEscape.run({ text: 'Caf&eacute; &mdash; 50&nbsp;&euro;', mode: 'decode' })).toBe('Café — 50\u00a0€')
    // Astral characters stay one code point rather than splitting into surrogates.
    expect(htmlEscape.run({ text: 'a😀', mode: 'encode', variant: 'non-ascii' })).toBe('a&#128512;')
    expect(htmlEscape.run({ text: 'a😀', mode: 'encode' })).toBe('a😀')
  })
})

describe('hex converter', () => {
  const hex = (input: object) => hexConverter.run(input) as Record<string, string>

  it('round-trips every input format to the same bytes', () => {
    const expected = hex({ text: 'Hi!', from: 'text' })
    for (const [from, text] of [
      ['hex', '48 69 21'],
      ['hex', '0x48,0x69,0x21'],
      ['hex', '486921'],
      ['binary', '01001000 01101001 00100001'],
      ['decimal', '72 105 33'],
    ] as const) {
      expect(hex({ text, from })).toEqual(expected)
    }
    expect(expected.Text).toBe('Hi!')
    expect(expected.Hex).toBe('486921')
    expect(expected.Bytes).toBe('3')
  })
  it('counts UTF-8 bytes, not characters', () => {
    // é is two bytes — the whole reason a "20 char" value overflows a varchar(20).
    expect(hex({ text: 'é', from: 'text' })).toMatchObject({ Hex: 'c3a9', Bytes: '2' })
  })
  it('base64-encodes the raw bytes, not a re-encoded string', () => {
    // Bytes >= 0x80 are where a latin1 round-trip through TextEncoder silently
    // doubles them; every row must describe the same 7 bytes.
    const out = hex({ text: 'Héllo!', from: 'text' })
    expect(out).toMatchObject({ Hex: '48c3a96c6c6f21', Bytes: '7', Base64: 'SMOpbGxvIQ==' })
    // Cross-check against the Base64 tool decoding it back to the original text.
    expect(base64.run({ text: out.Base64!, mode: 'decode' })).toBe('Héllo!')
  })
  it('reports non-UTF-8 bytes instead of showing replacement characters', () => {
    expect(hex({ text: 'ff fe', from: 'hex' }).Text).toBe('(not valid UTF-8 text)')
  })
  it('rejects malformed input with a message naming the problem', () => {
    expect(() => hex({ text: '4869 2', from: 'hex' })).toThrow(/even number/)
    expect(() => hex({ text: 'zz', from: 'hex' })).toThrow(/only contain 0-9/)
    expect(() => hex({ text: '0100100', from: 'binary' })).toThrow(/multiple of 8/)
    expect(() => hex({ text: '72 300', from: 'decimal' })).toThrow(/not a byte value/)
  })
})

describe('unicode inspector', () => {
  it('treats an emoji as one code point, not two surrogates', () => {
    const rows = unicodeInspector.run({ text: 'A😀' }) as string[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('U+0041')
    expect(rows[0]).toContain('Letter')
    expect(rows[1]).toContain('U+1F600')
    expect(rows[1]).toContain('UTF-8 F0 9F 98 80')
    expect(rows[1]).toContain('&#128512;')
  })
  it('gives control characters a visible stand-in', () => {
    const [row] = unicodeInspector.run({ text: ' ' }) as string[]
    expect(row).toContain('U+0000')
    expect(row).toContain('·')
  })
})

describe('code escape', () => {
  const esc = (text: string) => codeEscape.run({ text }) as Record<string, string>

  it('produces literals that evaluate back to the input', () => {
    const tricky = `it's "quoted" \\ and\nnewline\ttab`
    const out = esc(tricky)
    // The real check: eval the emitted literal and get the original string back.
    for (const key of ['JavaScript (single)', 'JavaScript (double)', 'JSON'] as const) {
      expect(JSON.parse(JSON.stringify(eval(out[key]!)))).toBe(tricky)
    }
  })
  it('doubles SQL quotes and wraps shell quotes', () => {
    expect(esc("O'Brien")['SQL (single-quoted)']).toBe("'O''Brien'")
    expect(esc("O'Brien")['Shell (POSIX)']).toBe(`'O'"'"'Brien'`)
  })
  it('escapes regex metacharacters so the result matches literally', () => {
    const input = 'a.b*c+d(e)'
    const pattern = esc(input)['Regex literal']!
    expect(new RegExp(pattern).test(input)).toBe(true)
    expect(new RegExp(pattern).test('aXbYcZd(e)')).toBe(false)
  })
})

describe('jwt signer', () => {
  const decodePart = (p: string) =>
    JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))

  it('mints a token the parser can read back', () => {
    const token = jwtSigner.run({ payload: '{"sub":"123"}', secret: 's3cret', algorithm: 'HS256' }) as string
    const parsed = jwtParser.run({ token }) as { header: Record<string, unknown>; payload: Record<string, unknown> }
    expect(parsed.header).toMatchObject({ alg: 'HS256', typ: 'JWT' })
    expect(parsed.payload).toMatchObject({ sub: '123' })
    expect(typeof parsed.payload.iat).toBe('number')
  })
  it('signs with the secret — a different secret gives a different signature', () => {
    const sig = (secret: string) =>
      (jwtSigner.run({ payload: '{"sub":"1"}', secret, expiresIn: 0 }) as string).split('.')[2]
    expect(sig('a')).not.toBe(sig('b'))
  })
  it('adds exp only when asked, and never overrides a payload that sets its own', () => {
    const withExp = jwtSigner.run({ payload: '{"sub":"1"}', secret: 'k', expiresIn: 60 }) as string
    const claims = decodePart(withExp.split('.')[1]!)
    expect(claims.exp).toBe(claims.iat + 60)

    const noExp = jwtSigner.run({ payload: '{"sub":"1"}', secret: 'k', expiresIn: 0 }) as string
    expect(decodePart(noExp.split('.')[1]!).exp).toBeUndefined()

    const own = jwtSigner.run({ payload: '{"iat":1,"exp":2}', secret: 'k', expiresIn: 60 }) as string
    expect(decodePart(own.split('.')[1]!)).toMatchObject({ iat: 1, exp: 2 })
  })
  it('refuses input that would produce a worthless token', () => {
    expect(() => jwtSigner.run({ payload: '{"sub":"1"}', secret: '' })).toThrow(/secret/)
    expect(() => jwtSigner.run({ payload: 'nope', secret: 'k' })).toThrow(/JSON object/)
    expect(() => jwtSigner.run({ payload: '[1,2]', secret: 'k' })).toThrow(/JSON object/)
  })
})

// Self-signed test certificate, generated with:
//   openssl req -x509 -newkey rsa:2048 -nodes -days 400 -subj "/C=US/O=Example Inc/CN=example.com" \
//     -addext "subjectAltName=DNS:example.com,DNS:www.example.com,IP:10.0.0.1"
// Its expected fingerprint/serial below come from openssl, not from node-forge,
// so the assertions catch a parser that agrees with itself but nothing else.
const FIXTURE_CERT = `-----BEGIN CERTIFICATE-----
MIIDhDCCAmygAwIBAgIUNo5vRFXcAChPS+JxG4th5Zp+Of8wDQYJKoZIhvcNAQEL
BQAwOTELMAkGA1UEBhMCVVMxFDASBgNVBAoMC0V4YW1wbGUgSW5jMRQwEgYDVQQD
DAtleGFtcGxlLmNvbTAeFw0yNjA3MTgyMTUxMDdaFw0yNzA4MjIyMTUxMDdaMDkx
CzAJBgNVBAYTAlVTMRQwEgYDVQQKDAtFeGFtcGxlIEluYzEUMBIGA1UEAwwLZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDdBijzXTyk
Ic2EQkOO4cZuJsHvrmibLQDe4L5L/6PXCT22DseeZlh8VdAdChRzx/c6lSDAV6EL
dDXROrtQlYosFmRlPu1OIA8LRCeTLSZWObgmNJUaN5L4g5V2BVRISzouLNzHO/8E
yWA6TUbNmZ9mYa6WsmrYe2mIJ8/bCK6R5OHdP87a5K+NCTgivDnrclkJB3HaOyqV
/pdnz6NBJui6ZPhdJ2wALhFJ+Dg31zYYoqts5z8gFM1wogXHUMNc1ffF4fQTw797
AJzx5x4Sd/5icussmWEZQEbaVHOR8VYQoSc0u69Slqu+IO7FVAQnqkQhiIUgo5J7
Qd+wUlwDE4cnAgMBAAGjgYMwgYAwHQYDVR0OBBYEFFwTJTBlaRQprFr+lFEIy/Q/
COJcMB8GA1UdIwQYMBaAFFwTJTBlaRQprFr+lFEIy/Q/COJcMA8GA1UdEwEB/wQF
MAMBAf8wLQYDVR0RBCYwJIILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxlLmNvbYcE
CgAAATANBgkqhkiG9w0BAQsFAAOCAQEAacxTw82xIBv4bACFVhMB2MwvCkee7ypp
wxegre35gtnyh3ot7uciQ9WpaJnPGq9FqUNNExBlI/gykXVgTV9O3F+WCV+HqCAq
UtEhkXdcu82dzGrcmlF9pj1zsR8yTOy9FmNw9c9QpWMiKUUwMFxXUW1+vJ4aZwwO
Uor+BqWvVgvD2skT2Lwa1E7tH0O24HwzokehNSX+xCHZddEl+SMCqb9TPdgRntmS
6J3AKiCt86oU9nDEvcNzXCsAlU7L0uyBDavF12yqxVIoMrzH1IACfyf5CfiQ+ZrN
Ve/icAA3+KaAws5PLGDpIDe+y91Z8qm8seaZCjUTwey9s7vuuUqImw==
-----END CERTIFICATE-----`

// Validity windows are relative to "now", so they can't be a static fixture —
// mint one on the fly. 512-bit keys keep it fast; nothing here verifies crypto.
function mintCert(startDaysFromNow: number, endDaysFromNow: number): string {
  const keys = forge.pki.rsa.generateKeyPair(512)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  const day = 86_400_000
  cert.validity.notBefore = new Date(Date.now() + startDaysFromNow * day)
  cert.validity.notAfter = new Date(Date.now() + endDaysFromNow * day)
  const attrs = [{ shortName: 'CN', value: 'old.example.com' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey)
  return forge.pki.certificateToPem(cert)
}

describe('crypto tools', () => {
  it('uuid + ulid counts', async () => {
    expect(((await uuidTool.run({ count: 3 })) as string[]).length).toBe(3)
    const ulids = ulidTool.run({ count: 2 }) as string[]
    expect(ulids[0]).toHaveLength(26)
  })
  it('uuid versions', async () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(((await uuidTool.run({ version: 'v4', count: 3 })) as string[]).length).toBe(3)
    expect(((await uuidTool.run({ version: 'v4', count: 1 })) as string[])[0]).toMatch(v4)
    // Name-based versions honor count (identical, deterministic) and allow empty name.
    const v5s = (await uuidTool.run({ version: 'v5', name: '', count: 3 })) as string[]
    expect(v5s.length).toBe(3)
    expect(new Set(v5s).size).toBe(1)
    expect(((await uuidTool.run({ version: 'v1', count: 1 })) as string[])[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    // Known RFC 4122 vectors: DNS namespace + "www.example.com".
    expect(((await uuidTool.run({ version: 'v3', name: 'www.example.com' })) as string[])[0]).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e')
    expect(((await uuidTool.run({ version: 'v5', name: 'www.example.com' })) as string[])[0]).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })
  it('hashes async', async () => {
    const h = await hashTool.run({ text: 'abc', algorithm: 'SHA-256' })
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('hmac with RFC 4231 vectors', () => {
    // Test Case 2: key="Jefe", data="what do ya want for nothing?"
    const out = (algo: string) => hmacTool.run({ text: "what do ya want for nothing?", secret: 'Jefe', algorithm: algo, encoding: 'hex' }) as string
    expect(out('MD5')).toBe('750c783e6ab0b503eaa86e310a5db738')
    expect(out('SHA1')).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79')
    expect(out('SHA256')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    // base64url output has no + / = chars.
    const b64url = hmacTool.run({ text: 'abc', secret: 'key', algorithm: 'SHA256', encoding: 'base64url' }) as string
    expect(b64url).not.toMatch(/[+/=]/)
  })
  it('hotp matches RFC 4226 test vectors', async () => {
    // Secret "12345678901234567890" (ASCII) as Base32, counters 0-9.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    for (let counter = 0; counter < expected.length; counter++) {
      const out = await totpHotpTool.run({ mode: 'HOTP', secret, algorithm: 'SHA1', digits: '6', counter })
      expect((out as { code: string }).code).toBe(expected[counter])
    }
  })
  it('totp matches RFC 6238 test vectors (via equivalent HOTP counters)', async () => {
    // T = floor(unixSeconds / 30) for each RFC 6238 Appendix B timestamp.
    const cases: [number, string, string, string][] = [
      [1, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'SHA1', '94287082'],
      [1, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====', 'SHA256', '46119246'],
      [37037036, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'SHA1', '07081804'],
      [66666666, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'SHA1', '69279037'],
    ]
    for (const [counter, secret, algorithm, code] of cases) {
      const out = await totpHotpTool.run({ mode: 'HOTP', secret, algorithm, digits: '8', counter })
      expect((out as { code: string }).code).toBe(code)
    }
  })
  it('totp reports a ticking code and time remaining', async () => {
    const out = (await totpHotpTool.run({ mode: 'TOTP', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: '6', period: 30 })) as { code: string; secondsRemaining: number; period: number }
    expect(out.code).toMatch(/^[0-9]{6}$/)
    expect(out.secondsRemaining).toBeGreaterThan(0)
    expect(out.period).toBe(30)
  })
  it('rejects a blank or malformed secret', async () => {
    await expect(totpHotpTool.run({ secret: '' })).rejects.toThrow(/Base32 secret/)
  })
  it('builds an otpauth enrolment URI an authenticator app can scan', async () => {
    const totp = (await totpHotpTool.run({ mode: 'TOTP', secret: 'jbswy3dp ehpk3pxp', algorithm: 'SHA256', digits: '8', period: 60, issuer: 'Example Inc', account: 'you@example.com' })) as { uri: string; qr: string }
    const url = new URL(totp.uri)
    expect(url.protocol).toBe('otpauth:')
    expect(url.host).toBe('totp')
    expect(decodeURIComponent(url.pathname)).toBe('/Example Inc:you@example.com')
    // Typed spacing/case is normalised — apps reject a secret that isn't canonical Base32.
    expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP')
    expect(url.searchParams.get('issuer')).toBe('Example Inc')
    expect(url.searchParams.get('algorithm')).toBe('SHA256')
    expect(url.searchParams.get('digits')).toBe('8')
    expect(url.searchParams.get('period')).toBe('60')
    expect(url.searchParams.get('counter')).toBeNull()
    expect(totp.qr).toContain('<svg')

    const hotp = (await totpHotpTool.run({ mode: 'HOTP', secret: 'JBSWY3DPEHPK3PXP', counter: 7 })) as { uri: string }
    expect(hotp.uri).toContain('otpauth://hotp/')
    expect(new URL(hotp.uri).searchParams.get('counter')).toBe('7')
  })
  it('rejects a too-short secret instead of hitting an empty HMAC key', async () => {
    await expect(totpHotpTool.run({ secret: 'A' })).rejects.toThrow(/too short/)
  })
  it('token + password honor length', () => {
    expect(tokenTool.run({ length: 16, charset: 'hex' })).toHaveLength(16)
    expect(passwordTool.run({ length: 24 })).toHaveLength(24)
    expect(() => passwordTool.run({ length: 10, uppercase: false, lowercase: false, digits: false, symbols: false })).toThrow()
  })
  it('token custom charset builds from toggles', () => {
    const digitsOnly = tokenTool.run({ length: 32, charset: 'custom', uppercase: false, lowercase: false, digits: true, symbols: false }) as string
    expect(digitsOnly).toHaveLength(32)
    expect(digitsOnly).toMatch(/^[0-9]+$/)
    expect(() => tokenTool.run({ charset: 'custom', uppercase: false, lowercase: false, digits: false, symbols: false })).toThrow()
  })
  it('analyses password strength', () => {
    const digitsOnly = passwordStrengthTool.run({ password: '223434234234' }) as Record<string, unknown>
    expect(digitsOnly['Password length']).toBe(12)
    expect(digitsOnly['Character set size']).toBe(10)
    expect(digitsOnly.Entropy).toBe('39.86 bits')
    expect(digitsOnly.Score).toBe('31 / 100')
    const strong = passwordStrengthTool.run({ password: 'Tr0ub4dor&3xyz!' }) as Record<string, unknown>
    expect(strong['Character set size']).toBe(87)
    expect(() => passwordStrengthTool.run({ password: '' })).toThrow()
  })
  it('encrypts + decrypts round-trip for every algorithm', () => {
    for (const algorithm of ['AES', 'TripleDES', 'Rabbit', 'RC4'] as const) {
      const cipher = encryptionTool.run({ text: 'hello world', secret: 's3cret', algorithm, mode: 'encrypt' }) as string
      expect(cipher).not.toBe('hello world')
      expect(encryptionTool.run({ text: cipher, secret: 's3cret', algorithm, mode: 'decrypt' })).toBe('hello world')
    }
  })
  it('throws on wrong decrypt secret', () => {
    const cipher = encryptionTool.run({ text: 'hi', secret: 'a', algorithm: 'AES', mode: 'encrypt' }) as string
    expect(() => encryptionTool.run({ text: cipher, secret: 'b', algorithm: 'AES', mode: 'decrypt' })).toThrow(/Could not decrypt/)
  })
  it('parses a jwt', () => {
    // {"alg":"HS256"} . {"sub":"42"} . sig
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.sig'
    const out = jwtParser.run({ token: jwt }) as { payload: { sub: string } }
    expect(out.payload.sub).toBe('42')
    expect(() => jwtParser.run({ token: 'bad' })).toThrow()
  })
  it('inspects an X.509 certificate', () => {
    const out = certParser.run({ pem: FIXTURE_CERT }) as Record<string, string>
    expect(out.Subject).toBe('C=US, O=Example Inc, CN=example.com')
    expect(out.Issuer).toBe('C=US, O=Example Inc, CN=example.com')
    expect(out['Self-signed']).toBe('Yes')
    expect(out['Subject alternative names']).toBe('DNS:example.com, DNS:www.example.com, IP:10.0.0.1')
    expect(out['Public key']).toBe('RSA 2048-bit')
    expect(out['Signature algorithm']).toBe('sha256WithRSAEncryption')
    expect(out['Certificate authority']).toBe('Yes — this is a CA certificate')
    // Cross-checked against `openssl x509 -noout -fingerprint -sha256 -serial`.
    expect(out['SHA-256 fingerprint']).toBe('F3:23:60:D6:3A:E3:21:1C:A1:68:B0:3C:92:6B:D3:F0:E0:B8:BB:81:94:A1:CD:87:99:C2:31:10:C5:01:05:15')
    expect(out['Serial number']).toBe('36:8E:6F:44:55:DC:00:28:4F:4B:E2:71:1B:8B:61:E5:9A:7E:39:FF')
    expect(out.Status).toMatch(/^Valid — expires in \d/)
    expect(out.Chain).toBeUndefined()
  })
  it('flags an expired certificate and counts a pasted chain', () => {
    const expired = mintCert(-60, -30)
    expect((certParser.run({ pem: expired }) as Record<string, string>).Status).toMatch(/^EXPIRED .* ago$/)
    const future = certParser.run({ pem: mintCert(30, 60) }) as Record<string, string>
    expect(future.Status).toMatch(/^Not yet valid — starts in /)
    // A pasted fullchain shows the leaf, and says how many blocks it found.
    const chain = certParser.run({ pem: `${FIXTURE_CERT}\n${expired}` }) as Record<string, string>
    expect(chain.Subject).toBe('C=US, O=Example Inc, CN=example.com')
    expect(chain.Chain).toBe('2 certificates in this PEM — showing the first (leaf)')
  })
  it('rejects input that is not a certificate', () => {
    expect(() => certParser.run({ pem: 'hello' })).toThrow(/No certificate found/)
    expect(() => certParser.run({ pem: '-----BEGIN CERTIFICATE-----\nbm90IGRlcg==\n-----END CERTIFICATE-----' })).toThrow(/Could not parse/)
  })
  it('generates a PEM RSA key pair and rounds bits to a multiple of 8', async () => {
    // 2050 isn't a multiple of 8 — rounds down to 2048 rather than throwing.
    const out = (await rsaKeyPairTool.run({ bits: 2050 })) as { publicKey: string; privateKey: string }
    expect(out.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----$/)
    expect(out.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/)
  })
})

describe('web tools', () => {
  it('parses a url into flat rows, assuming https when the scheme is missing', () => {
    expect(urlParser.run({ url: 'https://x.com:8080/p?a=1&a=2#h' })).toMatchObject({
      Origin: 'https://x.com:8080',
      Port: '8080',
      Path: '/p',
      // Repeated keys are numbered, not collapsed to the last value.
      '?a [1]': '1',
      '?a [2]': '2',
      Fragment: 'h',
    })
    expect(urlParser.run({ url: 'x.com/p' })).toMatchObject({ Origin: 'https://x.com', Port: '443 (default)' })
    // "host:8443/p" parses as scheme "host:" unless the scheme test demands "//".
    expect(urlParser.run({ url: 'shop.x.co.uk:8443/catalog' })).toMatchObject({
      Origin: 'https://shop.x.co.uk:8443',
      Hostname: 'shop.x.co.uk',
      Port: '8443',
      Path: '/catalog',
    })
    // Host-less schemes drop the origin/hostname rows instead of printing "null".
    const mail = urlParser.run({ url: 'mailto:you@example.com' }) as Record<string, string>
    expect(mail).toMatchObject({ Protocol: 'mailto', Path: 'you@example.com' })
    expect(mail.Origin).toBeUndefined()
  })
  it('encodes and decodes basic auth', () => {
    expect(basicAuth.run({ mode: 'encode', username: 'u', password: 'p' })).toMatchObject({
      Header: 'Authorization: Basic dTpw',
      Token: 'dTpw',
    })
    // Accepts the whole header line, not just the bare token.
    expect(basicAuth.run({ mode: 'decode', header: 'Authorization: Basic dTpw' })).toMatchObject({ Username: 'u', Password: 'p' })
    expect(() => basicAuth.run({ mode: 'decode', header: 'Basic aGk=' })).toThrow(/no ":"/)
  })
  it('slugifies with casing and word-boundary truncation', () => {
    expect(slugify.run({ text: 'Héllo World!' })).toBe('hello-world')
    expect(slugify.run({ text: '  --Hello--  ', separator: '_' })).toBe('hello')
    expect(slugify.run({ text: 'Hello World', case: 'upper' })).toBe('HELLO-WORLD')
    expect(slugify.run({ text: 'one two three', maxLength: 9 })).toBe('one-two')
    expect(() => slugify.run({ text: 'привет' })).toThrow(/non-ASCII/)
  })
  it('detects UA browser, engine, os version and bots', () => {
    expect(userAgent.run({ ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.6099.71 Safari/537.36' })).toMatchObject({
      Browser: 'Chrome 120.0.6099.71',
      Engine: 'Blink',
      OS: 'Windows 10/11',
      Device: 'Desktop',
    })
    // Edge carries Chrome/ too — the more specific marker has to win.
    expect(userAgent.run({ ua: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.61' })).toMatchObject({ Browser: 'Edge 120.0.2210.61' })
    expect(userAgent.run({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Version/17.2 Mobile Safari/604.1' })).toMatchObject({ OS: 'iOS 17.2', Device: 'Mobile' })
    expect(userAgent.run({ ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' })).toMatchObject({ Device: 'Bot / HTTP client' })
  })
  it('looks up status codes by number, text and class', () => {
    expect(httpStatus.run({ query: '404' })).toEqual({ '404 Not Found': expect.stringContaining('Client error') })
    expect(Object.keys(httpStatus.run({ query: 'not found' }) as object)).toContain('404 Not Found')
    expect(Object.keys(httpStatus.run({ query: '5xx' }) as object).every((k) => k.startsWith('5'))).toBe(true)
  })
})

describe('curl converter', () => {
  const CURL = `curl -X POST 'https://api.example.com/users?ref=docs' \\
  -H 'Content-Type: application/json' \\
  -H "Accept: application/json" \\
  -u admin:s3cr3t \\
  --data-raw '{"name":"Ada","tags":["x"]}'`

  it('tokenizes quotes, escapes and line continuations', () => {
    expect(tokenizeShell(`curl -H 'a: b c' --data "x=\\"1\\"" url`)).toEqual(['curl', '-H', 'a: b c', '--data', 'x="1"', 'url'])
    // An empty quoted argument survives as a token rather than vanishing.
    expect(tokenizeShell(`curl -d '' url`)).toEqual(['curl', '-d', '', 'url'])
    expect(() => tokenizeShell(`curl -H 'unclosed`)).toThrow(/Unbalanced quote/)
  })
  it('converts to fetch, inlining basic auth and re-indenting a JSON body', () => {
    const out = curlConverter.run({ command: CURL, target: 'fetch' }) as string
    expect(out).toContain(`await fetch("https://api.example.com/users?ref=docs"`)
    expect(out).toContain(`method: "POST"`)
    expect(out).toContain(`"Content-Type": "application/json"`)
    expect(out).toContain(`"Authorization": "Basic ${btoa('admin:s3cr3t')}"`)
    // A JSON body becomes a real object literal, not a wall of escaped quotes.
    expect(out).toContain('body: JSON.stringify({')
    expect(out).toContain('"name": "Ada"')
  })
  it('converts to axios and httpie', () => {
    const axios = curlConverter.run({ command: CURL, target: 'axios' }) as string
    expect(axios).toContain(`method: "post"`)
    expect(axios).toContain(`auth: { username: "admin", password: "s3cr3t" }`)
    const httpie = curlConverter.run({ command: CURL, target: 'httpie' }) as string
    expect(httpie).toContain(`http POST 'https://api.example.com/users?ref=docs'`)
    // HTTPie's own Header:value syntax, unquoted because it needs no shell quoting.
    expect(httpie).toContain(`Content-Type:application/json`)
    expect(httpie).toContain(`-a admin:s3cr3t`)
    // The JSON body does need quoting, and its inner quotes must survive.
    expect(httpie).toContain(`--raw='{"name":"Ada","tags":["x"]}'`)
  })
  it('infers the method, ignores transfer-only flags and reports a missing url', () => {
    expect(curlConverter.run({ command: `curl https://x.com`, target: 'fetch' })).toContain(`method: "GET"`)
    // No -X, but a body → POST, as curl itself would.
    expect(curlConverter.run({ command: `curl https://x.com -d a=1`, target: 'fetch' })).toContain(`method: "POST"`)
    // -o takes a value: it must not swallow the URL that follows it.
    expect(curlConverter.run({ command: `curl -s -o out.json https://x.com`, target: 'fetch' })).toContain(`"https://x.com"`)
    // Repeated -d concatenates into one form body.
    expect(curlConverter.run({ command: `curl https://x.com -d a=1 -d b=2`, target: 'fetch' })).toContain(`body: "a=1&b=2"`)
    expect(() => curlConverter.run({ command: `curl -X POST`, target: 'fetch' })).toThrow(/No URL/)
    expect(() => curlConverter.run({ command: `wget https://x.com`, target: 'fetch' })).toThrow(/start with "curl"/)
  })
})

describe('cookie inspector', () => {
  it('parses a Set-Cookie and warns about the flags it lacks', () => {
    const out = cookieParser.run({ cookie: 'Set-Cookie: sid=abc123; Path=/app; Max-Age=3600; SameSite=Lax' }) as Record<string, string>
    expect(out).toMatchObject({ Name: 'sid', Value: 'abc123', Path: '/app', SameSite: 'Lax', Lifetime: 'Persistent' })
    expect(out['Max-Age']).toContain('1 hour')
    expect(out['⚠ Secure']).toBeDefined()
    expect(out['⚠ HttpOnly']).toBeDefined()
    // SameSite is set, so that warning stays away.
    expect(out['⚠ SameSite']).toBeUndefined()
  })
  it('flags SameSite=None without Secure, and a bad __Host- prefix', () => {
    expect(cookieParser.run({ cookie: 'a=1; SameSite=None' })).toHaveProperty('⚠ SameSite=None')
    expect(cookieParser.run({ cookie: '__Host-sid=1; Path=/; Secure' })).not.toHaveProperty('⚠ __Host- prefix')
    expect(cookieParser.run({ cookie: '__Host-sid=1; Domain=x.com; Path=/; Secure' })).toHaveProperty('⚠ __Host- prefix')
  })
  it('detects a request Cookie header and lists every pair', () => {
    // No attributes anywhere → many cookies, not one cookie with odd attributes.
    expect(cookieParser.run({ cookie: 'Cookie: a=1; b=2; c=3' })).toEqual({ a: '1', b: '2', c: '3' })
  })
  it('treats a cookie with no expiry as a session cookie', () => {
    expect(cookieParser.run({ cookie: 'sid=1; Secure; HttpOnly; SameSite=Strict' })).toMatchObject({
      Lifetime: 'Session — cleared when the browser closes',
      Secure: 'Yes',
      HttpOnly: 'Yes',
    })
  })
})

describe('cache-control explainer', () => {
  it('explains directives and humanizes their durations', () => {
    const out = cacheControl.run({ value: 'public, max-age=3600, stale-while-revalidate=59' }) as Record<string, string>
    expect(out['max-age=3600']).toContain('1 hour')
    expect(out['stale-while-revalidate=59']).toContain('59 seconds')
    expect(out.public).toContain('Any cache')
  })
  it('flags contradictions and unknown directives', () => {
    expect(cacheControl.run({ value: 'no-store, max-age=60' })).toHaveProperty('⚠ Conflict')
    expect(cacheControl.run({ value: 'public, private' })).toHaveProperty('⚠ Conflict')
    expect(cacheControl.run({ value: 'immutable' })).toHaveProperty('⚠ immutable')
    expect(cacheControl.run({ value: 'max-age=3600, immutable' })).not.toHaveProperty('⚠ immutable')
    expect(cacheControl.run({ value: 'flibble' })).toMatchObject({ flibble: expect.stringContaining('Unknown directive') })
    // A directive that needs seconds but got something else says so.
    expect(cacheControl.run({ value: 'max-age=soon' })).toMatchObject({ 'max-age=soon': expect.stringContaining('seconds') })
  })
  it('accepts a pasted header line and blank input', () => {
    expect(cacheControl.run({ value: 'Cache-Control: no-store' })).toHaveProperty('no-store')
    expect(cacheControl.run({ value: '   ' })).toEqual({})
  })
})

describe('development tools', () => {
  it('regex finds matches', () => {
    const r = regexTester.run({ pattern: '\\d+', flags: 'g', text: 'a1 b22' }) as { count: number }
    expect(r.count).toBe(2)
  })
  it('cron fields expand ranges, steps and names', () => {
    expect([...parseCronField('*/15', 0, 59)]).toEqual([0, 15, 30, 45])
    expect([...parseCronField('1-3,10', 0, 59)]).toEqual([1, 2, 3, 10])
    expect([...parseCronField('MON-FRI', 0, 6)]).toEqual([1, 2, 3, 4, 5])
    expect([...parseCronField('7', 0, 6)]).toEqual([0]) // 0 and 7 are both Sunday
    expect(() => parseCronField('99', 0, 59)).toThrow()
    expect(() => parseCronField('5-1', 0, 59)).toThrow()
  })
  it('cron next runs respect every field', () => {
    const from = new Date(2026, 0, 1, 8, 30) // Thu 1 Jan 2026, 08:30 local
    expect(nextCronRuns('0 9 * * 1-5', 2, from).map((d) => d.toISOString())).toEqual([
      new Date(2026, 0, 1, 9, 0).toISOString(),
      new Date(2026, 0, 2, 9, 0).toISOString(),
    ])
    // Day-of-month and day-of-week are OR'd when both are restricted.
    const or = nextCronRuns('0 0 15 * 0', 2, from)
    expect(or.map((d) => d.getDate())).toEqual([4, 11]) // Sundays before the 15th
    // A date that never occurs yields nothing instead of hanging.
    expect(nextCronRuns('0 0 30 2 *', 1, from)).toEqual([])
  })
  it('cron descriptions read as English', () => {
    expect(describeCron('* * * * *')).toBe('Every minute, every day')
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes, every day')
    expect(describeCron('0 9 * * 1-5')).toBe('At 09:00, on Monday to Friday')
    expect(describeCron('0 9 * * 1,5')).toBe('At 09:00, on Monday and Friday')
    expect(describeCron('30 2 1 * *')).toBe('At 02:30, on day 1 of the month')
    expect(describeCron('*/20 8-10 15 JAN,JUL *')).toBe(
      'At minute 0, 20 and 40 past hour 8 to 10, on day 15 of the month, in January and July',
    )
    expect(() => describeCron('0 9 * *')).toThrow()
  })
  it('cron + email + case', () => {
    expect((cronGenerator.run({ minute: '0', hour: '9' }) as { expression: string }).expression).toBe('0 9 * * *')
    expect(emailNormalizer.run({ email: 'Foo.Bar+spam@gmail.com' })).toBe('foobar@gmail.com')
    expect(caseConverter.run({ text: 'hello world' })).toMatchObject({ camelCase: 'helloWorld', 'kebab-case': 'hello-world' })
  })
})

describe('image tools', () => {
  it('svg placeholder + qr produce svg', async () => {
    expect(svgPlaceholder.run({ width: 100, height: 50 })).toContain('<svg')
    expect(await qrCode.run({ text: 'hello' })).toContain('<svg')
  })
})

describe('networking tools', () => {
  it('calculates IPv4 networks and converts addresses', () => {
    expect(cidrCalculator.run({ cidr: '192.168.1.42/24' })).toMatchObject({
      Network: '192.168.1.0/24',
      Broadcast: '192.168.1.255',
      'Usable range': '192.168.1.1 – 192.168.1.254',
      'Usable hosts': '254',
    })
    expect(ipConverter.run({ value: '0xC0A80101' })).toMatchObject({ IPv4: '192.168.1.1', Integer: '3232235777' })
    expect(() => cidrCalculator.run({ cidr: '192.168.1.1/33' })).toThrow(/CIDR/)
  })

  it('generates locally administered unicast MAC addresses', () => {
    const addresses = macGenerator.run({ count: 3, separator: ':', uppercase: true }) as string[]
    expect(addresses).toHaveLength(3)
    expect(addresses.every((mac) => /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac))).toBe(true)
    expect(addresses.every((mac) => (Number.parseInt(mac.slice(0, 2), 16) & 3) === 2)).toBe(true)
  })
})

describe('data format tools', () => {
  it('round-trips JSON and YAML', () => {
    const yaml = jsonYaml.run({ text: '{"name":"DevDesk","enabled":true}', direction: 'JSON → YAML' }) as string
    expect(yaml).toContain('name: DevDesk')
    expect(JSON.parse(jsonYaml.run({ text: yaml, direction: 'YAML → JSON' }) as string)).toEqual({ name: 'DevDesk', enabled: true })
  })

  it('round-trips quoted CSV fields without losing embedded commas', () => {
    const csv = jsonCsv.run({ text: '[{"name":"Doe, Jane","active":true}]', direction: 'JSON → CSV' }) as string
    expect(csv).toBe('name,active\n"Doe, Jane",true')
    expect(JSON.parse(jsonCsv.run({ text: csv, direction: 'CSV → JSON' }) as string)).toEqual([{ name: 'Doe, Jane', active: 'true' }])
  })

  it('round-trips JSON Lines', () => {
    const jsonl = jsonLines.run({ text: '[{"id":1},{"id":2}]', direction: 'JSON → JSON Lines' }) as string
    expect(jsonl).toBe('{"id":1}\n{"id":2}')
    expect(JSON.parse(jsonLines.run({ text: jsonl, direction: 'JSON Lines → JSON' }) as string)).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('date and time tools', () => {
  it('converts Unix seconds and formats a target time zone', () => {
    expect(timestampConverter.run({ value: '0' })).toMatchObject({ 'ISO 8601 (UTC)': '1970-01-01T00:00:00.000Z', 'Unix seconds': '0' })
    expect(timezoneConverter.run({ value: '2026-01-01T00:00:00Z', zones: 'UTC' })).toMatchObject({ 'ISO 8601 (UTC)': '2026-01-01T00:00:00.000Z' })
    expect(() => timezoneConverter.run({ value: 'now', zones: 'Not/A_Zone' })).toThrow(/IANA/)
  })

  it('calculates durations in totals and human units', () => {
    expect(durationCalculator.run({ start: '2026-01-01T00:00:00Z', end: '2026-01-02T01:30:05Z' })).toMatchObject({
      Duration: '1d 1h 30m 5s',
      'Total seconds': '91805',
    })
  })
})

describe('math tools', () => {
  const rows = (plugin: { run: (i: unknown) => unknown }, input: unknown) =>
    plugin.run(input) as Record<string, string>

  it('percentage + eta + bytes', () => {
    expect(rows(percentage, { x: 25, y: 200 })['X is what % of Y']).toBe('12.5%')
    expect(rows(percentage, { x: 100, y: 50 })['X decreased by Y%']).toBe('50')
    expect(rows(percentage, { x: 16, y: 9 })['Ratio X : Y']).toBe('16 : 9')
    expect(eta.run({ total: 100, done: 50, elapsed: 10 })).toMatchObject({ 'Percent complete': '50%' })
    expect((byteConverter.run({ value: 1, unit: 'MB' }) as Record<string, number>).KB).toBe(1000)
  })

  it('eta scales the elapsed unit and bounds a timeline', () => {
    const out = rows(eta, { total: 100, done: 25, elapsed: 10, elapsedUnit: 'minutes' })
    expect(out.Remaining).toBe('30m')
    // The progress bar parses these two rows — they have to be real dates.
    expect(Number.isNaN(Date.parse(String(out.Started)))).toBe(false)
    expect(Number.isNaN(Date.parse(String(out['Finishes at'])))).toBe(false)
  })

  it('byte converter switches base and shows both human forms', () => {
    const out = rows(byteConverter, { value: 1, unit: 'GB', base: 'IEC (1024)' })
    expect(out.MiB).toBe(1024 as unknown as string)
    expect(out['Human (SI)']).toBe('1.07 GB')
  })

  it('stats summarises a pasted list', () => {
    const out = rows(stats, { numbers: '1, 2, 3, 4, 5\n6 7 8 9 10' })
    expect(out).toMatchObject({ Count: '10', Mean: '5.5', Median: '5.5', p90: '9.1' })
    expect(() => stats.run({ numbers: 'nothing here' })).toThrow(/No numbers/)
    expect(parseNumbers('a1 -2.5 3e2')).toEqual([1, -2.5, 300])
    expect(percentileOf([1, 2, 3, 4], 50)).toBe(2.5)
  })

  it('sla turns a target into a downtime budget', () => {
    const out = rows(slaUptime, { uptime: 99.9, budgetWindow: '30 days' })
    expect(out['Allowed downtime · per 30 days']).toBe('43m 12s')
    expect(out.Nines).toBe('3 nines')
    expect(rows(slaUptime, { uptime: 99.9, budgetWindow: '30 days', downtimeMinutes: 60 }).Status).toContain('breached')
  })

  it('base converter reads prefixes and rejects bad digits', () => {
    const out = rows(baseConverter, { value: '0xFF' })
    expect(out).toMatchObject({ Decimal: '255', Binary: '0b1111 1111', 'Fits in': 'uint8' })
    expect(rows(baseConverter, { value: '1010 1100', from: '2' }).Decimal).toBe('172')
    expect(rows(baseConverter, { value: '-42' }).Hexadecimal).toBe('-0x2A')
    expect(() => baseConverter.run({ value: '12z', from: '10' })).toThrow(/not a valid base-10/)
  })

  it('aspect ratio simplifies and scales', () => {
    const out = rows(aspectRatio, { width: 1920, height: 1080, targetWidth: 1280 })
    expect(out.Ratio).toBe('16:9')
    expect(out['Scaled to width']).toBe('1280 × 720')
    const box = rows(aspectRatio, { width: 1000, height: 1000, targetWidth: 100, targetHeight: 200 })
    expect(box['Fit inside box (contain)']).toBe('100 × 100')
    expect(box['Fill box (cover, crops)']).toBe('200 × 200')
  })

  it('transfer time treats bits and bytes apart', () => {
    const out = rows(transferTime, { size: 1, sizeUnit: 'GB', speed: 100, speedUnit: 'Mbps' })
    expect(out['Transfer time']).toBe('1m 20s')
    expect(out['Effective speed']).toContain('12.5 MB/s')
    expect(rows(transferTime, { size: 1, sizeUnit: 'GB', speed: 100, speedUnit: 'MB/s', efficiency: 50 })['Exact seconds']).toBe('20')
  })
})

describe('xml ↔ json', () => {
  it('maps attributes, text, CDATA and repeated children', () => {
    const xml = `<?xml version="1.0"?><!-- note --><user id="1" role="admin">
      <name>Ada &amp; Co</name><tag>a</tag><tag>b</tag><bio><![CDATA[<raw> & unescaped]]></bio>
    </user>`
    expect(JSON.parse(xmlJson.run({ text: xml, direction: 'XML → JSON' }) as string)).toEqual({
      user: {
        '@id': '1',
        '@role': 'admin',
        name: 'Ada & Co',
        tag: ['a', 'b'],
        bio: '<raw> & unescaped',
      },
    })
  })

  it('round-trips back to XML', () => {
    const json = '{"user":{"@id":"1","name":"Ada & Co","tag":["a","b"]}}'
    const xml = xmlJson.run({ text: json, direction: 'JSON → XML' }) as string
    expect(xml).toContain('<user id="1">')
    expect(xml).toContain('<name>Ada &amp; Co</name>')
    expect(xml).toContain('<tag>a</tag>')
    // Re-parsing the generated XML must yield the JSON we started from.
    expect(JSON.parse(xmlJson.run({ text: xml, direction: 'XML → JSON' }) as string)).toEqual(JSON.parse(json))
  })

  it('decodes numeric entities and self-closing tags', () => {
    expect(JSON.parse(xmlJson.run({ text: '<r><a>&#65;&#x42;</a><b/></r>', direction: 'XML → JSON' }) as string)).toEqual({
      r: { a: 'AB', b: '' },
    })
  })

  it('rejects malformed XML and multi-root JSON', () => {
    expect(() => xmlJson.run({ text: '<a><b></a>', direction: 'XML → JSON' })).toThrow(/does not match/)
    expect(() => xmlJson.run({ text: '<a>', direction: 'XML → JSON' })).toThrow(/Unclosed/)
    expect(() => xmlJson.run({ text: '{"a":1,"b":2}', direction: 'JSON → XML' })).toThrow(/exactly one root/)
  })
})

describe('.env ↔ json', () => {
  it('parses comments, export, quotes and inline comments', () => {
    const env = [
      '# leading comment',
      '',
      'export PORT=5432 # inline',
      'DATABASE_URL="postgres://localhost/app"',
      "RAW='no \\n escape'",
      'ESCAPED="line\\nbreak"',
    ].join('\n')
    expect(JSON.parse(envJson.run({ text: env, direction: '.env → JSON' }) as string)).toEqual({
      PORT: '5432',
      DATABASE_URL: 'postgres://localhost/app',
      RAW: 'no \\n escape',
      ESCAPED: 'line\nbreak',
    })
  })

  it('quotes only values that need it on the way back', () => {
    expect(envJson.run({ text: '{"A":"plain","B":"has space","C":{"n":1}}', direction: 'JSON → .env' })).toBe(
      'A=plain\nB="has space"\nC="{\\"n\\":1}"',
    )
  })

  it('rejects a line that is not KEY=VALUE', () => {
    expect(() => envJson.run({ text: 'JUST_A_KEY', direction: '.env → JSON' })).toThrow(/not KEY=VALUE/)
  })
})

describe('chmod calculator', () => {
  it('converts octal to symbolic and back', () => {
    expect(chmodCalculator.run({ mode: '755' })).toMatchObject({
      Octal: '0755',
      Symbolic: 'rwxr-xr-x',
      Owner: 'read, write, execute',
      Others: 'read, execute',
      Special: 'none',
      Command: 'chmod 755 <file>',
    })
    expect(chmodCalculator.run({ mode: 'rwxr-xr-x' })).toMatchObject({ Octal: '0755', Symbolic: 'rwxr-xr-x' })
  })

  it('round-trips the special bits through the execute slot', () => {
    // 4755 = setuid + rwxr-xr-x, so the owner execute slot reads 's'.
    expect(chmodCalculator.run({ mode: '4755' })).toMatchObject({ Symbolic: 'rwsr-xr-x', Special: 'setuid' })
    // 1777 = sticky + rwxrwxrwx — the classic /tmp mode.
    expect(chmodCalculator.run({ mode: '1777' })).toMatchObject({ Symbolic: 'rwxrwxrwt', Special: 'sticky' })
    // Capital S means the special bit is set but execute is off.
    expect(chmodCalculator.run({ mode: '4644' })).toMatchObject({ Symbolic: 'rwSr--r--' })
    expect(chmodCalculator.run({ mode: 'rwSr--r--' })).toMatchObject({ Octal: '4644' })
    expect(chmodCalculator.run({ mode: '-rwxrwxrwt' })).toMatchObject({ Octal: '1777' })
  })

  it('rejects anything that is not a mode', () => {
    expect(() => chmodCalculator.run({ mode: '999' })).toThrow(/octal mode/)
    expect(() => chmodCalculator.run({ mode: 'rwx' })).toThrow(/octal mode/)
  })
})

describe('uuid inspector', () => {
  it('reads version and variant', () => {
    expect(uuidInspector.run({ uuid: '9b2e4c1a-7f3d-4b8e-9c1f-2a3b4c5d6e7f' })).toMatchObject({
      Version: 'v4 — random',
      Variant: 'RFC 4122 / 9562',
    })
  })

  it('recovers the timestamp a v1 UUID embeds', async () => {
    // Generated by the v1 branch of the UUID tool, so the two stay in agreement.
    const [v1] = (await uuidTool.run({ version: 'v1', count: 1 })) as string[]
    const out = uuidInspector.run({ uuid: v1! }) as Record<string, string>
    expect(out.Version).toMatch(/^v1/)
    expect(Math.abs(Date.parse(out.Timestamp!) - Date.now())).toBeLessThan(60_000)
  })

  it('recovers the timestamp a v7 UUID embeds', () => {
    const ms = 1_700_000_000_000
    const hex = ms.toString(16).padStart(12, '0')
    const out = uuidInspector.run({ uuid: `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-1234567890ab` }) as Record<string, string>
    expect(out.Version).toMatch(/^v7/)
    expect(Date.parse(out.Timestamp!)).toBe(ms)
  })

  it('accepts braced and urn forms, and names the nil UUID', () => {
    expect(uuidInspector.run({ uuid: '{9b2e4c1a-7f3d-4b8e-9c1f-2a3b4c5d6e7f}' })).toMatchObject({ Version: 'v4 — random' })
    expect(uuidInspector.run({ uuid: 'urn:uuid:9b2e4c1a-7f3d-4b8e-9c1f-2a3b4c5d6e7f' })).toMatchObject({ Version: 'v4 — random' })
    expect(uuidInspector.run({ uuid: '00000000-0000-0000-0000-000000000000' })).toMatchObject({ Version: 'Nil UUID (all zero bits)' })
    expect(() => uuidInspector.run({ uuid: 'not-a-uuid' })).toThrow(/Not a UUID/)
  })
})

describe('date & time input parsing', () => {
  it('accepts keywords, offsets, and both timestamp scales', () => {
    const at = (v: string) => Number((timestampConverter.run({ value: v }) as Record<string, string>)['Unix milliseconds'])
    expect(Math.abs(at('now') - Date.now())).toBeLessThan(2000)
    // Seconds and milliseconds for the same instant must land on the same date.
    expect(at('1710000000')).toBe(at('1710000000000'))
    expect(at('+2d') - at('now')).toBeGreaterThan(2 * 86_400_000 - 2000)
    // "today" is local midnight, so tomorrow is one calendar day later.
    expect(new Date(at('tomorrow')).getDate()).toBe(new Date(at('today') + 86_400_000).getDate())
    expect(new Date(at('today')).getHours()).toBe(0)
  })

  it('rejects gibberish with a hint about what it accepts', () => {
    expect(() => timestampConverter.run({ value: 'not a date' })).toThrow(/Unix timestamp/)
    expect(() => timestampConverter.run({ value: '' })).toThrow()
  })

  it('reports ISO week, quarter, and leap year', () => {
    // 2026-01-01 is a Thursday, so it belongs to ISO week 1 of 2026.
    const out = timestampConverter.run({ value: '2026-01-01T12:00:00' }) as Record<string, string>
    expect(out['ISO week']).toBe('2026-W01')
    expect(out.Quarter).toBe('Q1 2026')
    expect(out['Leap year']).toBe('No')
    expect(out['Day of year']).toBe('1 of 365')
    expect((timestampConverter.run({ value: '2024-03-01T12:00:00' }) as Record<string, string>)['Leap year']).toBe('Yes')
    // 2027-01-01 is a Friday — ISO-8601 puts it in the *previous* year's last week.
    expect((timestampConverter.run({ value: '2027-01-01T12:00:00' }) as Record<string, string>)['ISO week']).toBe('2026-W53')
  })
})

describe('timezone converter', () => {
  it('shows one instant in every listed zone, with that zone’s offset', () => {
    const out = timezoneConverter.run({ value: '1710000000', zones: 'UTC, Asia/Tokyo' }) as Record<string, string>
    expect(out['ISO 8601 (UTC)']).toBe('2024-03-09T16:00:00.000Z')
    expect(out.UTC ?? out['UTC (local)']).toMatch(/GMT/)
    expect(out['Asia/Tokyo']).toContain('GMT+9')
    // Tokyo is a day ahead of UTC at this instant (01:00 on the 10th).
    expect(out['Asia/Tokyo']).toMatch(/10 Mar|Mar 10/)
  })

  it('always includes the local zone, without duplicating it', () => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    const keys = Object.keys(timezoneConverter.run({ value: 'now', zones: local }) as Record<string, string>)
    expect(keys.filter((k) => k.startsWith(local))).toHaveLength(1)
    expect(keys[0]).toBe(`${local} (local)`)
  })

  it('rejects a bad zone by name', () => {
    expect(() => timezoneConverter.run({ value: 'now', zones: 'Mars/Olympus' })).toThrow(/Mars\/Olympus/)
  })
})

describe('duration calculator', () => {
  it('separates exact elapsed time from the calendar count', () => {
    const out = durationCalculator.run({ start: '2026-01-31T09:00:00', end: '2026-03-01T09:00:00' }) as Record<string, string>
    expect(out.Duration).toBe('29d 0h 0m 0s')
    // Jan 31 → Mar 1 is "1 month and 1 day" the way a person counts it.
    expect(out.Calendar).toBe('1mo 1d')
    expect(out.Direction).toBe('Forward')
  })

  it('counts weekdays only for business days', () => {
    // Mon 2026-01-05 → Mon 2026-01-12 spans exactly five working days.
    const out = durationCalculator.run({ start: '2026-01-05T00:00:00', end: '2026-01-12T00:00:00' }) as Record<string, string>
    expect(out['Business days']).toBe('5')
    expect(out['Total weeks']).toBe('1')
  })

  it('flags a backwards range but still reports the magnitude', () => {
    const out = durationCalculator.run({ start: '2026-01-02T00:00:00', end: '2026-01-01T00:00:00' }) as Record<string, string>
    expect(out.Direction).toBe('End is before start')
    expect(out.Duration).toBe('1d 0h 0m 0s')
    expect(out.Calendar).toBe('1d')
  })
})

describe('date calculator', () => {
  const on = (out: unknown) => new Date((out as Record<string, string>)['ISO 8601 (local)']!)

  it('clamps month arithmetic to the last valid day', () => {
    const d = on(dateCalculator.run({ date: '2026-01-31T12:00:00', amount: 1, unit: 'months', direction: 'add' }))
    expect(d.getMonth()).toBe(1) // February
    expect(d.getDate()).toBe(28) // not the 3rd of March
    const leap = on(dateCalculator.run({ date: '2024-01-31T12:00:00', amount: 1, unit: 'months', direction: 'add' }))
    expect(leap.getDate()).toBe(29)
  })

  it('subtracts, and handles years as twelve clamped months', () => {
    const d = on(dateCalculator.run({ date: '2024-02-29T12:00:00', amount: 1, unit: 'years', direction: 'add' }))
    expect(d.getDate()).toBe(28)
    expect(d.getFullYear()).toBe(2025)
    const back = on(dateCalculator.run({ date: '2026-03-10T12:00:00', amount: 10, unit: 'days', direction: 'subtract' }))
    expect(back.getDate()).toBe(28)
    expect(back.getMonth()).toBe(1)
  })

  it('skips weekends for business days in both directions', () => {
    // Friday 2026-01-02 + 1 business day is Monday the 5th, not Saturday the 3rd.
    expect(on(dateCalculator.run({ date: '2026-01-02T12:00:00', amount: 1, unit: 'business days', direction: 'add' })).getDate()).toBe(5)
    // Monday 2026-01-05 − 1 business day is the preceding Friday.
    expect(on(dateCalculator.run({ date: '2026-01-05T12:00:00', amount: 1, unit: 'business days', direction: 'subtract' })).getDate()).toBe(2)
  })

  it('reports what it did alongside the result', () => {
    const out = dateCalculator.run({ date: '2026-01-01T00:00:00', amount: 3, unit: 'weeks', direction: 'add' }) as Record<string, string>
    expect(out.Shift).toBe('+3 weeks')
    expect(on(out).getDate()).toBe(22)
  })
})

describe('iso 8601 duration', () => {
  it('round-trips ISO durations through seconds', () => {
    const out = isoDuration.run({ value: 'PT1H30M' }) as Record<string, string>
    expect(out['Total seconds']).toBe('5400')
    expect(out['ISO 8601']).toBe('PT1H30M')
    expect(out.Human).toBe('1 hour, 30 minutes')
    expect((isoDuration.run({ value: 'P1DT6H' }) as Record<string, string>)['Total hours']).toBe('30')
    expect((isoDuration.run({ value: 'P2W' }) as Record<string, string>)['Total days']).toBe('14')
  })

  it('accepts shorthand, bare seconds, and negatives', () => {
    const seconds = (v: string) => (isoDuration.run({ value: v }) as Record<string, string>)['Total seconds']
    expect(seconds('1h 30m')).toBe('5400')
    expect(seconds('90 minutes')).toBe('5400')
    expect(seconds('5400')).toBe('5400')
    expect(seconds('-PT30M')).toBe('-1800')
    expect((isoDuration.run({ value: '-PT30M' }) as Record<string, string>)['ISO 8601']).toBe('-PT30M')
  })

  it('never emits years or months, since neither has a fixed length', () => {
    // P1Y is read as 365 days on input, but written back in days.
    const out = isoDuration.run({ value: 'P1Y' }) as Record<string, string>
    expect(out['Total days']).toBe('365')
    expect(out['ISO 8601']).toBe('P365D')
  })

  it('rejects input it cannot read', () => {
    expect(() => isoDuration.run({ value: 'nonsense' })).toThrow(/ISO 8601/)
    expect(() => isoDuration.run({ value: 'P' })).toThrow()
  })
})

describe('color converter', () => {
  it('converts hex to every other notation', () => {
    const out = colorConverter.run({ color: '#3b82f6' }) as Record<string, string>
    expect(out.RGB).toBe('rgb(59, 130, 246)')
    expect(out.HSL).toBe('hsl(217, 91%, 60%)')
    expect(out.Hex).toBe('#3b82f6')
  })

  it('accepts shorthand hex, rgb(), hsl(), and CSS names', () => {
    const hex = (v: string) => (colorConverter.run({ color: v }) as Record<string, string>).Hex
    expect(hex('#39f')).toBe('#3399ff')
    expect(hex('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(hex('hsl(0, 100%, 50%)')).toBe('#ff0000')
    expect(hex('teal')).toBe('#008080')
    expect(hex('3b82f6')).toBe('#3b82f6') // bare, no leading #
  })

  it('carries alpha through without letting it distort contrast', () => {
    const out = colorConverter.run({ color: '#3b82f680' }) as Record<string, string>
    expect(out.RGBA).toBe('rgba(59, 130, 246, 0.5)')
    // Contrast is computed on the opaque colour, so it matches the alpha-free form.
    expect(out['Contrast on white']).toBe((colorConverter.run({ color: '#3b82f6' }) as Record<string, string>)['Contrast on white'])
  })

  it('scores contrast against WCAG thresholds', () => {
    const white = colorConverter.run({ color: '#ffffff' }) as Record<string, string>
    expect(white['Contrast on black']).toBe('21.00:1')
    expect(white['Best text color']).toMatch(/^black — 21.00:1 \(AAA\)/)
    // Dark navy: white text reads better on it than black.
    const dark = colorConverter.run({ color: '#1e3a8a' }) as Record<string, string>
    expect(dark['Best text color']).toMatch(/^white/)
  })

  it('rejects things that are not colors', () => {
    expect(() => colorConverter.run({ color: 'not-a-color' })).toThrow(/hex/)
    expect(() => colorConverter.run({ color: '#12345' })).toThrow(/3, 4, 6, or 8/)
  })
})

describe('networking tools', () => {
  const kv = (out: unknown) => out as Record<string, string>

  it('calculates a CIDR network', () => {
    const out = kv(cidrCalculator.run({ cidr: '192.168.1.10/24' }))
    expect(out.Network).toBe('192.168.1.0/24')
    expect(out.Netmask).toBe('255.255.255.0')
    expect(out.Wildcard).toBe('0.0.0.255')
    expect(out.Broadcast).toBe('192.168.1.255')
    expect(out['Usable range']).toBe('192.168.1.1 – 192.168.1.254')
    expect(out['Usable hosts']).toBe('254')
    expect(out.Scope).toMatch(/RFC 1918/)
    expect(out['Reverse DNS']).toBe('10.1.168.192.in-addr.arpa')
  })

  it('keeps both addresses on a /31 and one on a /32', () => {
    expect(kv(cidrCalculator.run({ cidr: '10.0.0.4/31' }))['Usable hosts']).toBe('2')
    expect(kv(cidrCalculator.run({ cidr: '10.0.0.4/32' }))['Usable range']).toBe('10.0.0.4 – 10.0.0.4')
  })

  it('accepts a dotted netmask or a bare address', () => {
    expect(kv(cidrCalculator.run({ cidr: '10.0.0.1 255.255.255.0' })).Network).toBe('10.0.0.0/24')
    expect(kv(cidrCalculator.run({ cidr: '10.0.0.1' })).Network).toBe('10.0.0.1/32')
    // 255.0.255.0 has a hole in it — a typo, not a mask.
    expect(() => cidrCalculator.run({ cidr: '10.0.0.1 255.0.255.0' })).toThrow(/contiguous/)
  })

  it('classifies special-use ranges, most-specific first', () => {
    const scope = (cidr: string) => kv(cidrCalculator.run({ cidr })).Scope
    expect(scope('255.255.255.255/32')).toMatch(/broadcast/i)
    expect(scope('240.0.0.1/32')).toMatch(/Reserved/)
    expect(scope('100.64.0.1/32')).toMatch(/Carrier-grade/)
    expect(scope('169.254.1.1/32')).toMatch(/Link-local/)
    expect(scope('8.8.8.8/32')).toMatch(/Public/)
  })

  it('converts IPv4 between representations', () => {
    const out = kv(ipConverter.run({ value: '192.168.1.1' }))
    expect(out.Integer).toBe('3232235777')
    expect(out.Hexadecimal).toBe('0xC0A80101')
    expect(out.Binary).toBe('11000000.10101000.00000001.00000001')
    expect(kv(ipConverter.run({ value: '3232235777' })).IPv4).toBe('192.168.1.1')
    expect(kv(ipConverter.run({ value: '0xC0A80101' })).IPv4).toBe('192.168.1.1')
  })

  it('expands and compresses IPv6', () => {
    const out = kv(ipConverter.run({ value: '2001:db8::1' }))
    expect(out.Expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(out.Compressed).toBe('2001:db8::1')
    expect(out.Scope).toMatch(/Documentation/)
    // Round-trips: the expanded form compresses back to what we started with.
    expect(kv(ipConverter.run({ value: out.Expanded! })).Compressed).toBe('2001:db8::1')
    // Brackets and a zone id are stripped; a trailing dotted quad is two hextets.
    expect(kv(ipConverter.run({ value: '[fe80::1%eth0]' })).Scope).toMatch(/Link-local/)
    // RFC 5952 §5: an IPv4-mapped address keeps its dotted tail, hex-ified.
    const mapped = kv(ipConverter.run({ value: '::ffff:192.0.2.1' }))
    expect(mapped['Embedded IPv4']).toBe('192.0.2.1')
    expect(mapped.Compressed).toBe('::ffff:192.0.2.1')
    expect(mapped['URL form']).toBe('[::ffff:192.0.2.1]')
    expect(kv(ipConverter.run({ value: '::1' }))['Reverse DNS']).toMatch(/\.ip6\.arpa$/)
    expect(() => ipConverter.run({ value: '::1::2' })).toThrow(/only once/)
  })

  it('compresses the longest zero run, leftmost on a tie', () => {
    // Two runs of two: RFC 5952 says compress the first.
    expect(kv(ipConverter.run({ value: '2001:0:0:1:0:0:2:3' })).Compressed).toBe('2001::1:0:0:2:3')
    expect(kv(ipConverter.run({ value: '0:0:0:0:0:0:0:0' })).Compressed).toBe('::')
  })

  it('splits a network into equal subnets', () => {
    const out = kv(subnetSplitter.run({ cidr: '10.0.0.0/24', newPrefix: 26 }))
    expect(out.Summary).toMatch(/^4 × \/26 — 62 usable/)
    expect(out['Subnet 1']).toContain('10.0.0.0/26')
    expect(out['Subnet 1']).toContain('10.0.0.1 – 10.0.0.62')
    expect(out['Subnet 4']).toContain('10.0.0.192/26')
    // The parent's own bits are honoured, not the address typed inside it.
    expect(kv(subnetSplitter.run({ cidr: '10.0.0.130/24', newPrefix: 25 }))['Subnet 1']).toContain('10.0.0.0/25')
  })

  it('refuses splits that go the wrong way or explode', () => {
    expect(() => subnetSplitter.run({ cidr: '10.0.0.0/24', newPrefix: 16 })).toThrow(/larger/)
    expect(() => subnetSplitter.run({ cidr: '10.0.0.0/8', newPrefix: 32 })).toThrow(/shorter/)
  })

  it('summarises a range into the fewest CIDR blocks', () => {
    const out = kv(ipRangeCidr.run({ value: '192.168.1.5 - 192.168.1.100' }))
    expect(out['Total addresses']).toBe('96')
    expect(out['Blocks needed']).toBe('8')
    expect(out['Block 1']).toContain('192.168.1.5/32')
    // An aligned power-of-two range collapses to exactly one block.
    const clean = kv(ipRangeCidr.run({ value: '10.0.0.0 - 10.0.0.255' }))
    expect(clean['Blocks needed']).toBe('1')
    expect(clean['Block 1']).toContain('10.0.0.0/24')
    expect(() => ipRangeCidr.run({ value: '10.0.0.9 - 10.0.0.1' })).toThrow(/lower than/)
  })

  it('expands a block back into a range', () => {
    const out = kv(ipRangeCidr.run({ value: '10.0.0.0/22' }))
    expect(out.Range).toBe('10.0.0.0 – 10.0.3.255')
    expect(out['Total addresses']).toBe('1,024')
  })

  it('matches addresses against CIDR blocks, longest prefix first', () => {
    const out = kv(cidrMatcher.run({
      addresses: '10.0.5.20\n8.8.8.8',
      cidrs: '10.0.0.0/8\n10.0.5.0/24',
    }))
    expect(out['10.0.5.20']).toBe('✓ 10.0.5.0/24 (also 10.0.0.0/8)')
    expect(out['8.8.8.8']).toBe('✗ no match')
    expect(out['Overlap 1']).toMatch(/⚠ 10\.0\.0\.0\/8 overlaps 10\.0\.5\.0\/24/)
    expect(() => cidrMatcher.run({ addresses: '10.0.0.1', cidrs: '' })).toThrow(/at least one CIDR/)
  })

  it('generates MAC addresses', () => {
    const macs = macGenerator.run({ count: 3, separator: ':', uppercase: true, prefix: '' }) as string[]
    expect(macs).toHaveLength(3)
    for (const mac of macs) {
      expect(mac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/)
      // Locally administered (bit 1 set) and unicast (bit 0 clear).
      expect(Number.parseInt(mac.slice(0, 2), 16) & 0x03).toBe(0x02)
    }
    const cisco = macGenerator.run({ count: 1, separator: 'cisco', uppercase: false, prefix: '00:1A:2B' }) as string[]
    expect(cisco[0]).toMatch(/^001a\.2b[0-9a-f]{2}\.[0-9a-f]{4}$/)
    expect(() => macGenerator.run({ count: 1, separator: ':', uppercase: true, prefix: '00:1' })).toThrow(/whole hex bytes/)
  })

  it('inspects a MAC address', () => {
    const out = kv(macInspector.run({ mac: '00-1A-2B-3C-4D-5E' }))
    expect(out.Colon).toBe('00:1A:2B:3C:4D:5E')
    expect(out.Cisco).toBe('001a.2b3c.4d5e')
    expect(out.OUI).toBe('00:1A:2B')
    expect(out.Administration).toMatch(/Universally/)
    expect(out.Transmission).toBe('Unicast')
    // RFC 4291: FF:FE inserted mid-address, U/L bit flipped (00 -> 02).
    expect(out['EUI-64 interface ID']).toBe('021a:2bff:fe3c:4d5e')
    expect(out['IPv6 link-local']).toBe('fe80::21a:2bff:fe3c:4d5e')

    const broadcast = kv(macInspector.run({ mac: 'ffffffffffff' }))
    expect(broadcast.Transmission).toMatch(/Multicast/)
    expect(broadcast.Note).toMatch(/Broadcast/)
    expect(() => macInspector.run({ mac: '00:1A:2B' })).toThrow(/48-bit/)
  })

  it('looks up ports by number, name, and range', () => {
    const pg = kv(portReference.run({ query: '5432' }))
    expect(pg.Range).toMatch(/User \/ registered/)
    expect(pg['postgresql (TCP)']).toBe('PostgreSQL')
    expect(kv(portReference.run({ query: '80' })).Range).toMatch(/needs root/)
    expect(kv(portReference.run({ query: '54321' })).Assignment).toMatch(/No well-known service/)
    expect(kv(portReference.run({ query: 'redis' }))['6379/TCP']).toMatch(/^redis —/)
    // An empty query lists the whole reference rather than nothing.
    expect(Object.keys(kv(portReference.run({ query: '' })))).toHaveLength(63)
    expect(kv(portReference.run({ query: 'zzz' })).Result).toMatch(/Nothing matches/)
    expect(() => portReference.run({ query: '99999' })).toThrow(/0 to 65535/)
  })
})

describe('image & color tools', () => {
  const kv = (out: unknown) => out as Record<string, string>

  it('builds harmonies by rotating hue', () => {
    const out = kv(colorPalette.run({ color: '#ff0000', harmony: 'complementary' }))
    expect(out.Base).toBe('#ff0000')
    // 180° off pure red is cyan.
    expect(out.Complement).toBe('#00ffff')
    expect(Object.keys(kv(colorPalette.run({ color: '#ff0000', harmony: 'triadic' })))).toHaveLength(3)
  })

  it('produces a full 50-950 scale that runs light to dark', () => {
    const scale = kv(colorPalette.run({ color: '#3b82f6', harmony: 'scale' }))
    expect(Object.keys(scale)).toHaveLength(11)
    const lightness = (hex: string) => rgbToHsl(parseColor(hex))[2]
    expect(lightness(scale['50']!)).toBeGreaterThan(lightness(scale['500']!))
    expect(lightness(scale['500']!)).toBeGreaterThan(lightness(scale['950']!))
  })

  it('keeps tints and shades distinct even from an extreme base', () => {
    // A near-black base has almost no room to darken; the steps must still differ
    // rather than collapsing into six copies of the same colour.
    const shades = kv(colorPalette.run({ color: '#111111', harmony: 'tints' }))
    expect(new Set(Object.values(shades)).size).toBe(6)
  })

  it('grades contrast against WCAG and suggests a fix when it fails', () => {
    const black = kv(contrastChecker.run({ foreground: '#000000', background: '#ffffff' }))
    expect(black['Contrast ratio']).toBe('21.00:1')
    expect(black['AAA — normal text (7:1)']).toMatch(/Pass/)
    expect(black['Suggested foreground']).toBeUndefined()

    const weak = kv(contrastChecker.run({ foreground: '#aaaaaa', background: '#ffffff' }))
    expect(weak['AA — normal text (4.5:1)']).toMatch(/Fail/)
    // The suggestion must actually clear the bar it was computed for.
    const fixed = weak['Suggested foreground']!.split(' ')[0]!
    expect(contrastRatio(parseColor(fixed), parseColor('#ffffff'))).toBeGreaterThanOrEqual(4.5)
  })

  it('strips decoration from an SVG without touching the drawing', () => {
    const dirty = `<?xml version="1.0"?>\n<!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://inkscape" inkscape:version="1.0" viewBox="0 0 10 10">\n  <path d="M0 0L10 10"/>\n</svg>`
    const out = kv(svgOptimizer.run({ svg: dirty }))
    expect(out.Optimized).not.toContain('<!--')
    expect(out.Optimized).not.toContain('inkscape')
    expect(out.Optimized).toContain('<path d="M0 0L10 10"/>')
    // The real xmlns must survive — without it the SVG will not render.
    expect(out.Optimized).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out['Data URI']).toMatch(/^data:image\/svg\+xml,/)
    expect(out.Saved).toMatch(/^\d+ bytes \(\d+%\)$/)
    expect(() => svgOptimizer.run({ svg: 'not markup' })).toThrow(/does not look like an SVG/)
  })

  it('escapes a placeholder label instead of breaking the document', () => {
    const svg = svgPlaceholder.run({ text: 'A & B <script>', width: 100, height: 50 }) as string
    expect(svg).toContain('A &amp; B &lt;script&gt;')
    expect(svg).not.toContain('<script>')
    // A named preset overrides the width/height fields.
    expect(svgPlaceholder.run({ size: 'OG image 1200×630' }) as string).toContain('width="1200"')
  })

  it('builds gradient CSS with stops in position order', () => {
    const css = gradientCss({
      type: 'linear',
      angle: 90,
      stops: [{ color: '#fff', position: 100 }, { color: '#000', position: 0 }],
    })
    expect(css).toBe('linear-gradient(90deg, #000 0%, #fff 100%)')
    expect(gradientCss({ type: 'conic', angle: 0, stops: [], repeating: true })).toMatch(/^repeating-conic-gradient/)
  })

  it('finds the dominant colours in a pixel buffer', () => {
    // Six red pixels, two blue, one fully transparent white that must not vote.
    const px = new Uint8ClampedArray([
      ...Array.from({ length: 6 }, () => [250, 10, 10, 255]).flat(),
      ...Array.from({ length: 2 }, () => [10, 10, 250, 255]).flat(),
      255, 255, 255, 0,
    ])
    const [first, second, ...rest] = dominantColors(px, 6)
    expect(first).toBe('#fa0a0a')
    expect(second).toBe('#0a0afa')
    expect(rest).toHaveLength(0)
  })
})
