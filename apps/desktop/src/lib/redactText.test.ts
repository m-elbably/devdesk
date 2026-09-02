import { describe, expect, it } from 'vitest'
import { redactText } from './redactText'

describe('redactText', () => {
  it('removes common secret values while leaving surrounding output readable', () => {
    expect(redactText('Authorization: Bearer abc.def\napi_key="shh"\nname=Ada')).toBe('Authorization: Bearer [REDACTED]\napi_key=[REDACTED]\nname=Ada')
  })
})
