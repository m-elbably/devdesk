import { describe, it, expect, beforeAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { _resetRegistry, registerBuiltinTools } from '@devdesk/tools'
import ToolRunner from './ToolRunner.vue'

beforeAll(() => {
  _resetRegistry()
  registerBuiltinTools()
})

describe('ToolRunner (generic tool UI)', () => {
  it('runs a live text tool (base64) as the user types', async () => {
    const wrapper = mount(ToolRunner, { props: { toolId: 'base64' } })
    await wrapper.find('textarea').setValue('hi')
    await flushPromises()
    expect(wrapper.text()).toContain('aGk=')
  })

  it('renders keyvalue output (case-converter)', async () => {
    const wrapper = mount(ToolRunner, { props: { toolId: 'case-converter' } })
    await wrapper.find('input').setValue('hello world')
    await flushPromises()
    expect(wrapper.text()).toContain('helloWorld')
    expect(wrapper.text()).toContain('hello-world')
  })

  it('shows an error for invalid input instead of crashing', async () => {
    const wrapper = mount(ToolRunner, { props: { toolId: 'jwt-parser' } })
    await wrapper.find('textarea').setValue('not-a-jwt')
    await flushPromises()
    expect(wrapper.text().toLowerCase()).toContain('valid jwt')
  })
})
