import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import JwtView from './JwtView.vue'

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const now = Math.floor(Date.now() / 1000)

function mountWith(payload: Record<string, unknown>) {
  const header = { alg: 'HS256', typ: 'JWT' }
  return mount(JwtView, {
    props: {
      token: `${b64(header)}.${b64(payload)}.sig`,
      header,
      payload,
      signature: 'sig',
    },
    global: { stubs: { UBadge: { template: '<span><slot /></span>' }, CopyButton: true } },
  })
}

describe('JwtView', () => {
  it('reads exp/nbf to say whether the token is usable right now', () => {
    // Two hours, not one: `now` is floored, so a 1h offset lands just under the
    // hour boundary and renders as "60 minutes" — true, but brittle to assert on.
    expect(mountWith({ exp: now + 7200 }).text()).toContain('Expires in 2 hours')
    expect(mountWith({ exp: now - 7200 }).text()).toContain('Expired 2 hours ago')
    expect(mountWith({ nbf: now + 7200, exp: now + 10800 }).text()).toContain('Not valid yet — starts in 2 hours')
    expect(mountWith({ sub: 'x' }).text()).toContain('No expiry claim')
  })

  it('decodes epoch claims to a readable date and labels known claims', () => {
    const text = mountWith({ iat: now - 60, sub: '123' }).text()
    expect(text).toContain('1 minute ago')
    expect(text).toContain('Subject')
  })

  it('dims the other segments while one is hovered', async () => {
    const wrapper = mountWith({ sub: '123' })
    const segments = wrapper.findAll('span.transition-opacity')
    expect(segments).toHaveLength(3)
    await segments[1]!.trigger('mouseenter')
    expect(segments[0]!.classes()).toContain('opacity-30')
    expect(segments[1]!.classes()).not.toContain('opacity-30')
  })
})
