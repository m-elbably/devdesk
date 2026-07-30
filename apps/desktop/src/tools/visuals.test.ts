import { describe, it, expect, beforeAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { _resetRegistry, registerBuiltinTools } from '@devdesk/tools'
import ToolRunner from './ToolRunner.vue'
import ChmodGrid from './ChmodGrid.vue'
import BitRuler from './BitRuler.vue'
import TimelineBar from './TimelineBar.vue'

beforeAll(() => {
  _resetRegistry()
  registerBuiltinTools()
})

describe('ChmodGrid', () => {
  it('reflects a symbolic mode as nine checkboxes', () => {
    const grid = mount(ChmodGrid, { props: { symbolic: 'rw-r--r--' } })
    const checked = grid.findAll('[aria-label]').map((c) => c.attributes('aria-checked'))
    expect(checked).toEqual(['true', 'true', 'false', 'true', 'false', 'false', 'true', 'false', 'false'])
  })

  it('keeps a special bit when its execute slot is toggled off', async () => {
    // setuid + owner execute is "s"; turning execute off must leave "S", not "-",
    // or the grid silently drops the setuid bit the user never touched.
    const grid = mount(ChmodGrid, { props: { symbolic: 'rwsr-xr-x' } })
    await grid.findAll('[aria-label]')[2]!.trigger('click')
    expect(grid.emitted('update')?.[0]).toEqual(['rwSr-xr-x'])
  })

  it('renders nothing for a mode it cannot read', () => {
    expect(mount(ChmodGrid, { props: { symbolic: 'nonsense' } }).text()).toBe('')
  })
})

describe('BitRuler', () => {
  it('splits 32 bits into network and host for a prefix', () => {
    const ruler = mount(BitRuler, { props: { address: '192.168.1.10', prefix: 24 } })
    const bits = ruler.findAll('[title^="Bit "]')
    expect(bits).toHaveLength(32)
    expect(bits.filter((b) => b.attributes('title')!.includes('network'))).toHaveLength(24)
    expect(ruler.text()).toContain('256 addresses')
  })

  it('lays out bits without a network/host split when there is no prefix', () => {
    const ruler = mount(BitRuler, { props: { address: '192.168.1.1' } })
    expect(ruler.findAll('[title*="network"]')).toHaveLength(0)
    expect(ruler.text()).not.toContain('network bits')
  })

  it('renders nothing for a non-address', () => {
    expect(mount(BitRuler, { props: { address: 'not.an.ip' } }).text()).toBe('')
  })
})

describe('TimelineBar', () => {
  const HOUR = 3_600_000
  const caption = (from: number, to: number) => mount(TimelineBar, { props: { from, to } }).text()

  it('reports progress while now is inside the span', () => {
    const now = Date.now()
    expect(caption(now - 2 * HOUR, now + HOUR)).toContain('67% elapsed')
  })

  it('calls out a span that has already ended', () => {
    const now = Date.now()
    expect(caption(now - 3 * HOUR, now - HOUR)).toContain('Ended')
  })

  it('calls out a span that has not started', () => {
    const now = Date.now()
    expect(caption(now + HOUR, now + 3 * HOUR)).toContain('Starts')
  })
})

describe('spec-declared visuals', () => {
  it('shows the bit ruler above the CIDR table', async () => {
    const wrapper = mount(ToolRunner, { props: { toolId: 'cidr-calculator' } })
    await flushPromises()
    expect(wrapper.findComponent(BitRuler).exists()).toBe(true)
    expect(wrapper.text()).toContain('24 network bits')
  })

  it('writes a chmod grid toggle back through the mode field', async () => {
    const wrapper = mount(ToolRunner, { props: { toolId: 'chmod-calculator' } })
    await flushPromises()
    // Default 644; switching on owner-execute has to round-trip via the plugin.
    await wrapper.findComponent(ChmodGrid).findAll('[aria-label]')[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('744')
  })
})
