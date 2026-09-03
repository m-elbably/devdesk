import { describe, expect, it } from 'vitest'
import { PRESET_ORDER, PROVIDER_PRESETS, configFromPreset, isLocalProvider, localityOf } from './presets'

describe('localityOf', () => {
  it('treats loopback as local', () => {
    for (const url of [
      'http://localhost:1234/v1',
      'http://127.0.0.1:11434/v1',
      'https://127.5.5.5/v1',
      'http://[::1]:1234/v1',
      'http://0.0.0.0:8080/v1',
    ]) {
      expect(localityOf(url), url).toBe('local')
    }
  })

  it('treats private and link-local addresses as local', () => {
    for (const url of [
      'http://10.0.0.5:1234/v1',
      'http://172.16.0.1/v1',
      'http://172.31.255.254/v1',
      'http://192.168.1.20:1234/v1',
      'http://169.254.1.1/v1',
      'http://[fd00::1]/v1',
      'http://[fe80::1]/v1',
    ]) {
      expect(localityOf(url), url).toBe('local')
    }
  })

  it('treats mDNS names as local', () => {
    expect(localityOf('http://mac-studio.local:1234/v1')).toBe('local')
  })

  it('treats public hosts as remote', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.deepseek.com/v1',
      'https://generativelanguage.googleapis.com/v1beta',
      'http://8.8.8.8/v1',
      'http://172.15.0.1/v1',
      'http://172.32.0.1/v1',
      'http://11.0.0.1/v1',
    ]) {
      expect(localityOf(url), url).toBe('remote')
    }
  })

  it('fails closed', () => {
    // Anything not provably on this machine is remote, because getting this wrong in
    // the other direction hands a NEVER_PERSIST tool to a third-party API.
    for (const url of ['', 'not a url', 'localhost:1234', '://broken', 'http://']) {
      expect(localityOf(url), JSON.stringify(url)).toBe('remote')
    }
  })

  it('is not fooled by a hostname that merely looks local', () => {
    for (const url of [
      'https://localhost.evil.com/v1',
      'https://127.0.0.1.evil.com/v1',
      'https://notlocalhost/v1',
      'https://local.example.com/v1',
      'https://192.168.1.1.example.com/v1',
    ]) {
      expect(localityOf(url), url).toBe('remote')
    }
  })

  it('ignores userinfo, which can spoof the host in a careless parser', () => {
    expect(localityOf('https://localhost@api.openai.com/v1')).toBe('remote')
  })
})

describe('presets', () => {
  it('offers every kind, local ones first', () => {
    expect(new Set(PRESET_ORDER)).toEqual(new Set(Object.keys(PROVIDER_PRESETS)))
    expect(PRESET_ORDER.slice(0, 2)).toEqual(['lmstudio', 'ollama'])
  })

  it('agrees with localityOf about which presets are local', () => {
    expect(isLocalProvider(PROVIDER_PRESETS.lmstudio)).toBe(true)
    expect(isLocalProvider(PROVIDER_PRESETS.ollama)).toBe(true)
    expect(isLocalProvider(PROVIDER_PRESETS.openai)).toBe(false)
    expect(isLocalProvider(PROVIDER_PRESETS.deepseek)).toBe(false)
    expect(isLocalProvider(PROVIDER_PRESETS.gemini)).toBe(false)
  })

  it('requires a key exactly for the cloud providers', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      if (preset.kind === 'custom') continue
      expect(preset.needsKey, preset.kind).toBe(!isLocalProvider(preset))
    }
  })

  it('tells the user how to fix the local servers that block browser origins', () => {
    expect(PROVIDER_PRESETS.lmstudio.hint).toMatch(/cors/i)
    expect(PROVIDER_PRESETS.ollama.hint).toMatch(/OLLAMA_ORIGINS/)
  })
})

describe('configFromPreset', () => {
  it('starts a local provider unredacted and keyless', () => {
    const config = configFromPreset('lmstudio', 'p1')
    expect(config).toMatchObject({ id: 'p1', kind: 'lmstudio', apiKey: '', transport: 'auto', redact: false })
  })

  it('turns redaction on by default wherever text leaves the machine', () => {
    for (const kind of ['openai', 'deepseek', 'gemini'] as const) {
      expect(configFromPreset(kind, 'p').redact, kind).toBe(true)
    }
  })

  it('leaves a custom provider redacting, since its URL is unknown until typed', () => {
    // An empty base URL is unparseable, so localityOf calls it remote — the safe default.
    expect(configFromPreset('custom', 'p').redact).toBe(true)
  })
})
