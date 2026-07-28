import { describe, expect, it, vi } from 'vitest'
import { shuffledCopy } from './shuffle'

describe('shuffledCopy', () => {
  it('uses Fisher-Yates with an injectable random source', () => {
    const randomValues = [0, 0.5, 0.99]
    const random = vi.fn(() => randomValues.shift() ?? 0)

    expect(shuffledCopy(['a', 'b', 'c', 'd'], random)).toEqual(['d', 'c', 'b', 'a'])
    expect(random).toHaveBeenCalledTimes(3)
  })

  it('returns a shuffled copy without mutating the input', () => {
    const input = Object.freeze(['a', 'b', 'c', 'd'])

    const result = shuffledCopy(input, () => 0)

    expect(result).toEqual(['b', 'c', 'd', 'a'])
    expect(result).not.toBe(input)
    expect(input).toEqual(['a', 'b', 'c', 'd'])
  })

  it.each([
    { input: [] },
    { input: ['only'] },
  ])('copies a list with fewer than two items without reading randomness', ({ input }) => {
    const random = vi.fn(() => 0)

    const result = shuffledCopy(input, random)

    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(random).not.toHaveBeenCalled()
  })
})
