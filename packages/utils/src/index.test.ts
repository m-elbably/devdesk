import { describe, it, expect } from 'vitest'
import { clamp, groupBy, fuzzyScore } from './index'

describe('clamp', () => {
  it('bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('groupBy', () => {
  it('groups by key', () => {
    const r = groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'even' : 'odd'))
    expect(r).toEqual({ odd: [1, 3], even: [2, 4] })
  })
})

describe('fuzzyScore', () => {
  it('matches subsequence and rewards adjacency', () => {
    expect(fuzzyScore('je', 'json editor')).not.toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
    expect(fuzzyScore('xyz', 'abc')).toBeNull()
    // "jsn" is more contiguous in "json" than in "j..s..n" so it scores lower
    expect(fuzzyScore('json', 'json')!).toBeLessThan(fuzzyScore('json', 'j_s_o_n')!)
  })
})
