import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ThemeSwitcher from './ThemeSwitcher.vue'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeSwitcher', () => {
  it('toggles and persists the theme', async () => {
    const wrapper = mount(ThemeSwitcher)

    await wrapper.find('button').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('vueuse-color-scheme')).toBe('dark')

    await wrapper.find('button').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // vueuse stores 'auto' rather than 'light' when the choice matches the
    // system preference (matchMedia is stubbed to light in vitest.setup).
    expect(localStorage.getItem('vueuse-color-scheme')).toBe('auto')
  })
})
